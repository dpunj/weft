import os
from io import BytesIO
from elevenlabs import play, VoiceSettings
from elevenlabs.client import ElevenLabs

client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))

def text_to_speech_stream(text: str) -> BytesIO:
    audio = BytesIO()
    # tts conversion
    response = client.text_to_speech.convert(
        text=text,
        voice_id="pNInz6obpgDQGcFmaJgB",  # Adam pre-made voice
        model_id="eleven_multilingual_v2",
        voice_settings=VoiceSettings(
            stability=0.0,
            similarity_boost=1.0,
            style=0.0,
            use_speaker_boost=True,
        ),
    )

    for chunk in response:
        audio.write(chunk)
    audio.seek(0)
    return audio

# testing
if __name__ == "__main__":
    play(text_to_speech_stream("heya just testing out the elevenlabs api"))