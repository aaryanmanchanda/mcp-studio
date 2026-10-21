package registry

import mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"

// content types that flow between the demo nodes
const (
	videoMP4  = "video/mp4"
	audioMP3  = "audio/mpeg"
	textJSON  = "application/vnd.mcpstudio.text+json"
	emailJSON = "application/vnd.mcpstudio.email+json"
)

// short helpers so the manifests below stay readable
func str(name string) *mcpstudiov1.ConfigFieldDef {
	return &mcpstudiov1.ConfigFieldDef{Name: name, AuthType: "none", ValueType: mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_STRING}
}

func num(name string) *mcpstudiov1.ConfigFieldDef {
	return &mcpstudiov1.ConfigFieldDef{Name: name, AuthType: "none", ValueType: mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_NUMBER}
}

func enum(name string, values ...string) *mcpstudiov1.ConfigFieldDef {
	return &mcpstudiov1.ConfigFieldDef{Name: name, AuthType: "none", ValueType: mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_ENUM, EnumValues: values}
}

func secret(name string) *mcpstudiov1.ConfigFieldDef {
	return &mcpstudiov1.ConfigFieldDef{Name: name, Secret: true, AuthType: "api_key", ValueType: mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_STRING}
}

// the weekly lecture write-up pipeline:
// youtube-download -> (format-converter, auto-inserted) -> groq-transcribe -> (shape adapter) -> gemini-notes -> email-send
func demoManifests() []*mcpstudiov1.NodeManifest {
	return []*mcpstudiov1.NodeManifest{
		{
			Id:       "youtube-download",
			Category: "Sources",
			Outputs: []*mcpstudiov1.SocketDef{
				{Name: "video_out", ContentType: videoMP4}, // a blob, no schema
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				str("url"), // a youtube url, or a local file path as a demo-day fallback
				num("max_minutes"),
			},
		},
		{
			Id:       "groq-transcribe",
			Category: "Processing",
			Inputs: []*mcpstudiov1.SocketDef{
				{Name: "audio_in", ContentType: audioMP3},
			},
			Outputs: []*mcpstudiov1.SocketDef{
				{
					Name:        "transcript",
					ContentType: textJSON,
					SchemaJson:  `{"type":"object","properties":{"text":{"type":"string"},"language":{"type":"string"},"duration_sec":{"type":"number"}}}`,
				},
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				secret("groq_api_key"),
				enum("model", "whisper-large-v3-turbo", "whisper-large-v3"),
				str("language"), // optional iso code like "en", blank means auto-detect
			},
		},
		{
			Id:       "gemini-notes",
			Category: "Processing",
			Inputs: []*mcpstudiov1.SocketDef{
				{
					Name:        "transcript_in",
					ContentType: textJSON, // same type as the transcript output, different shape -> the shape adapter earns its keep
					SchemaJson:  `{"type":"object","properties":{"text":{"type":"string"},"language":{"type":"string"},"title":{"type":"string"}}}`,
				},
			},
			Outputs: []*mcpstudiov1.SocketDef{
				{
					Name:        "email_out",
					ContentType: emailJSON,
					SchemaJson:  `{"type":"object","properties":{"subject":{"type":"string"},"body":{"type":"string"}}}`,
				},
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				secret("gemini_api_key"),
				enum("model", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"),
				enum("style", "lecture notes", "executive summary", "study questions"),
			},
		},
		{
			// same input and output sockets as gemini-notes, so it drops into the same place in a pipeline: swap one for the other
			Id:       "gemini-quiz",
			Category: "Processing",
			Inputs: []*mcpstudiov1.SocketDef{
				{
					Name:        "transcript_in",
					ContentType: textJSON,
					SchemaJson:  `{"type":"object","properties":{"text":{"type":"string"},"language":{"type":"string"},"title":{"type":"string"}}}`,
				},
			},
			Outputs: []*mcpstudiov1.SocketDef{
				{
					Name:        "email_out",
					ContentType: emailJSON,
					SchemaJson:  `{"type":"object","properties":{"subject":{"type":"string"},"body":{"type":"string"}}}`,
				},
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				secret("gemini_api_key"),
				enum("model", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"),
				num("num_questions"), // 1 to 30, default 8
				enum("question_type", "multiple choice", "true/false", "short answer"),
				enum("difficulty", "easy", "medium", "hard"),
				enum("answer_key", "include", "leave out"),
			},
		},
		{
			Id:       "email-send",
			Category: "Sinks",
			Inputs: []*mcpstudiov1.SocketDef{
				{
					Name:        "email_in",
					ContentType: emailJSON,
					SchemaJson:  `{"type":"object","properties":{"subject":{"type":"string"},"body":{"type":"string"}}}`,
				},
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				secret("gmail_app_password"),
				str("from_address"),
				str("to_address"),
			},
		},
	}
}
