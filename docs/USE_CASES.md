# What the current nodes can already do

Nodes today: **Youtube Download** (a link, or a path to a local video/audio file), **Format Converter** (auto-inserted), **Groq Transcribe**, **Gemini Notes** (3 styles), **Gemini Quiz**, **Email Send** (comma-separated recipients work).
The shape is always: get media, transcribe, have Gemini write something, email it. Changing the use case means changing the source, the Gemini node and its settings, and the recipients.

| Use case | Source | Middle node and settings | Recipient |
|---|---|---|---|
| Weekly lecture notes (the demo) | lecture link | Gemini Notes, `lecture notes` | yourself or a class list |
| Quiz for students from a lecture | lecture link | **Gemini Quiz**, multiple choice, medium, answer key included | the teacher (answer key in) |
| Quiz to hand out | same | Gemini Quiz, `answer_key = leave out` | students; send the key separately |
| Revision questions with answers | same | Gemini Notes, `study questions` | students |
| Meeting or call recording to action points | local recording path | Gemini Notes, `executive summary` | the team (comma-separated) |
| Webinar follow-up | webinar link | Gemini Notes, `executive summary` | attendees |
| Podcast or interview digest | episode link or local file | Gemini Notes, `executive summary` | yourself |
| Short comprehension check for training videos | training video | Gemini Quiz, true/false, easy | new hires |
| Oral-exam practice | lecture link | Gemini Quiz, short answer, hard | a student |

Notes:
- Same pipeline, new content: change only the `url` on Youtube Download and press Run.
- To switch notes to quiz, drag Gemini Quiz in place of Gemini Notes; the sockets are identical, so every wire still connects. Each node keeps its own saved keys, so enter the Gemini key on the new node.
- A local audio file (mp3, m4a) in the `url` field should also work, because ffmpeg reads the real format. Not tested.
- Transcription language: leave `language` blank for auto-detect, or set an ISO code. Non-English quality is untested.
- Not possible yet: translating, posting anywhere except email, several videos in one run, scheduling.
