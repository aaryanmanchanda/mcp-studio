// the node registry: every node type the palette can offer.
// phase2.go holds the original canvas-only fixtures; demo.go holds the nodes the PoC pipeline actually runs.
package registry

import mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"

// Manifests is what ListNodeManifests serves
func Manifests() []*mcpstudiov1.NodeManifest {
	return append(phase2Fixtures(), demoManifests()...)
}

// ByID indexes the registry so the executor can look a node's manifest up by id
func ByID() map[string]*mcpstudiov1.NodeManifest {
	out := map[string]*mcpstudiov1.NodeManifest{}
	for _, m := range Manifests() {
		out[m.Id] = m
	}
	return out
}
