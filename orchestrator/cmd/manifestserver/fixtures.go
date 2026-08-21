// phase 2 stubs of the real v1 node set (D-01), to be kept and fleshed out phase 3 onwards
// ship of theseus?
package main

import (
	mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"
)

func fixtureManifests() []*mcpstudiov1.NodeManifest {
	return []*mcpstudiov1.NodeManifest{
		{
			Id:       "youtube-scraper",
			Category: "Sources",
			Outputs: []*mcpstudiov1.SocketDef{
				{
					Name:        "clips",
					ContentType: "application/vnd.mcpstudio.clip-list+json",
					SchemaJson: `{
							"type": "object",
							"properties": {
								"video_id": {"type":"string"},
								"source_url": {"type":"string"},
								"duration_sec": {"type":"number"}
							}
						}`,
					//supposed to return a list of clips (Phase 3 onwards)
				},
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				{
					Name:       "video_url",
					Secret:     false,
					AuthType:   "none",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_STRING,
					EnumValues: nil,
				},
				{
					Name:       "max_results",
					Secret:     false,
					AuthType:   "none",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_NUMBER,
					EnumValues: nil, //only a number for this phase, need to discover limitations and switch to enum later
				},
			},
		},
		{
			Id:       "relevance-filter",
			Category: "Processing",
			Inputs: []*mcpstudiov1.SocketDef{ // same as outputs from scraper
				{
					Name:        "clips_in",
					ContentType: "application/vnd.mcpstudio.clip-list+json",
					SchemaJson: `{
					"type": "object",
					"properties": {
						"video_id": {"type":"string"},
						"source_url": {"type":"string"},
						"duration_sec": {"type":"number"}
						}
					}`,
				},
			},
			Outputs: []*mcpstudiov1.SocketDef{ //same shape as input but diff field name, same field type
				{
					Name:        "clips_out",
					ContentType: "application/vnd.mcpstudio.clip-list+json",
					SchemaJson: `{
					"type": "object",
					"properties": {
						"videoid": {"type":"string"},
						"sourceurl": {"type":"string"},
						"score": {"type":"number"}
						}
					}`,
				},
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				{
					Name:       "groq_api_key",
					Secret:     true,
					AuthType:   "api_key",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_STRING,
					EnumValues: nil,
				},
				{
					Name:       "model",
					Secret:     false,
					AuthType:   "none",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_ENUM,
					EnumValues: []string{"1.2", "1.3"},
				},
				{
					Name:       "min_score",
					Secret:     false,
					AuthType:   "none",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_NUMBER,
					EnumValues: nil,
				},
				{
					Name:       "strict_mode",
					Secret:     false,
					AuthType:   "none",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_BOOLEAN,
					EnumValues: nil,
				},
			},
		},
		{
			Id:       "trim-clip",
			Category: "Processing",
			Inputs: []*mcpstudiov1.SocketDef{ // videoid, sourceurl change, score is dropped and duration goes in empty
				{
					Name:        "clips_in",
					ContentType: "application/vnd.mcpstudio.clip-list+json",
					SchemaJson: `{
					"type": "object",
					"properties": {
						"VideoId": {"type":"string"},
						"SourceUrl": {"type":"string"},
						"DurationSec": {"type":"number"}
						}
					}`,
				},
			},
			Outputs: []*mcpstudiov1.SocketDef{ //not a json schema, blob O/P
				{
					Name:        "clip",
					ContentType: "video/quicktime",
					SchemaJson:  ``,
				},
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				{
					Name:       "start_sec",
					Secret:     false,
					AuthType:   "none",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_NUMBER,
					EnumValues: nil,
				},
				{
					Name:       "end_sec",
					Secret:     false,
					AuthType:   "none",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_NUMBER,
					EnumValues: nil,
				},
			},
		},
		{
			Id:       "caption-generator",
			Category: "Processing",
			Inputs: []*mcpstudiov1.SocketDef{ // Blob I/P exact match, no JSON schema
				{
					Name:        "video_in",
					ContentType: "video/quicktime",
					SchemaJson:  ``,
				},
			},
			Outputs: []*mcpstudiov1.SocketDef{ // back to JSON output bc captions
				{
					Name:        "captions",
					ContentType: "application/vnd.mcpstudio.captions+json",
					SchemaJson: `{
						"type": "object",
						"properties":{
							"start_sec": {"type":"number"},
							"end_sec": {"type":"number"},
							"text": {"type":"string"}
						}
					}`,
				},
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				{
					Name:       "elevenlabs_api_key",
					Secret:     true,
					AuthType:   "api_key",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_STRING,
					EnumValues: nil,
				},
				{
					Name:       "language",
					Secret:     false,
					AuthType:   "none",
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_ENUM,
					EnumValues: []string{"English", "Hindi", "Spanish", "Punjabi"},
				},
			},
		},
		{
			Id:       "format-converter", // one video format to another
			Category: "Convert",
			Inputs: []*mcpstudiov1.SocketDef{
				{
					Name:        "media_in",
					ContentType: "application/x-mcpstudio-converter-wildcard", // wildcard
					SchemaJson:  ``,
				},
			},
			Outputs: []*mcpstudiov1.SocketDef{ // back to JSON output bc captions
				{
					Name:        "media_out",
					ContentType: "application/x-mcpstudio-converter-wildcard",
					SchemaJson:  ``,
				},
			},
			Converts: []*mcpstudiov1.ConverterPair{ // 2 hop conversion quicktime->mp4->webm (BFS path to be added)
				{
					From: "video/quicktime",
					To:   "video/mp4",
				},
				{
					From: "video/mp4",
					To:   "video/webm",
				},
			},
		},
		{
			Id:       "upload-post", // sink
			Category: "Sinks",
			Inputs: []*mcpstudiov1.SocketDef{
				{
					Name:        "video_in",
					ContentType: "video/webm", // converted vid
					SchemaJson:  ``,
				},
			},
			ConfigFields: []*mcpstudiov1.ConfigFieldDef{
				{
					Name:       "youtube_api_key",
					Secret:     true,
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_STRING,
					AuthType:   "api_key",
					EnumValues: nil,
				},
				{
					Name:       "title",
					Secret:     false,
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_STRING,
					AuthType:   "none",
					EnumValues: nil,
				},
				{
					Name:       "privacy",
					Secret:     false,
					ValueType:  mcpstudiov1.ConfigFieldValueType_CONFIG_FIELD_VALUE_TYPE_ENUM,
					AuthType:   "none",
					EnumValues: []string{"private", "unlisted", "public"},
				},
			},
		},
	}
}
