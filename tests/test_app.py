from io import BytesIO
import wave

import pytest
from fastapi.testclient import TestClient
import app as backend
from sarvam_api import SarvamClient


def make_wav():
    data=BytesIO()
    with wave.open(data,'wb') as w:
        w.setnchannels(1);w.setframerate(24000);w.setsampwidth(2);w.writeframes(b'\x00\x00'*2400)
    return data.getvalue()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_PASSWORD','private-pass')
    monkeypatch.setenv('SARVAM_API_KEY','fake-key')
    return TestClient(backend.app)


def test_frontend_served(client):
    r=client.get('/')
    assert r.status_code==200 and 'NarrateAI' in r.text
    assert client.get('/app.js').status_code==200
    assert client.get('/styles.css').status_code==200


def test_health_no_secrets(client):
    r=client.get('/api/health')
    assert r.status_code==200 and r.json()['api_key_configured']
    assert 'fake-key' not in r.text


def test_auth_fail_closed(client, monkeypatch):
    r=client.post('/api/speech',json={'text':'Hello world'})
    assert r.status_code==401
    monkeypatch.delenv('APP_ACCESS_PASSWORD')
    r=client.post('/api/speech',json={'text':'Hello world'},headers={'x-app-password':'something'})
    assert r.status_code==503


def test_speech_validates_and_proxies(client,monkeypatch):
    got={}
    def fake_tts(self,text,language,model,speaker,pace=1,temperature=.6):
        got.update(locals());return make_wav()
    monkeypatch.setattr(SarvamClient,'bulbul',fake_tts)
    r=client.post('/api/speech',json={'text':'Hello world','model':'bulbul:v4-flash','language':'en-IN','speaker':'simran_en_customer'},headers={'x-app-password':'private-pass'})
    assert r.status_code==200, r.text
    assert r.content[:4]==b'RIFF'
    assert got['speaker']=='simran_en_customer'
    assert r.headers['cache-control']=='private, no-store'
    too_long=client.post('/api/speech',json={'text':'x'*501},headers={'x-app-password':'private-pass'})
    assert too_long.status_code==422


def test_document_upload(client):
    r=client.post('/api/extract', files={'file':('test.txt',b'Hello world!','text/plain')},headers={'x-app-password':'private-pass'})
    assert r.status_code==200 and r.json()=={'text':'Hello world!'}


def test_translation(client,monkeypatch):
    monkeypatch.setattr(SarvamClient,'translate',lambda *args:'नमस्ते')
    r=client.post('/api/translate',json={'text':'Hello','source':'en-IN','target':'hi-IN'},headers={'x-app-password':'private-pass'})
    assert r.status_code==200 and r.json()['text']=='नमस्ते'


def test_clone_requires_consent(client,monkeypatch):
    monkeypatch.setattr(SarvamClient,'create_voice',lambda *args:'svc-123')
    form={'name':'Narrator','language':'en-IN','style':'audiobooks','consent':'false'}
    file={'file':('voice.wav',make_wav(),'audio/wav')}
    r=client.post('/api/voices/create',data=form,files=file,headers={'x-app-password':'private-pass'})
    assert r.status_code==422
    form['consent']='true'
    r=client.post('/api/voices/create',data=form,files=file,headers={'x-app-password':'private-pass'})
    assert r.status_code==200 and r.json()['voice_id']=='svc-123'


def test_temperature_only_for_v3(monkeypatch):
    payloads=[]
    def capture(self,method,path,**kwargs):
        payloads.append(kwargs['json']);return {'audios':['UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=']}
    monkeypatch.setattr(SarvamClient,'_request',capture)
    c=SarvamClient('fake')
    c.bulbul('Hi','en-IN','bulbul:v4-flash','simran_en_customer')
    c.bulbul('Hi','en-IN','bulbul:v3','shubh')
    assert 'temperature' not in payloads[0]
    assert 'temperature' in payloads[1]
