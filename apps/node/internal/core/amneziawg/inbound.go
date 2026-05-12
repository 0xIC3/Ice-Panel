package amneziawg

import (
	"fmt"
	"net"
)

// inboundCfgWire mirrors AmneziawgConfigSchema in
// apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts.
//
// On the agent side we don't need ServerPublicKey — it's emitted by the
// panel into the wg-quick client conf, the server only ever uses the private
// half. We accept the field on the wire so the JSON shape stays identical
// and ignore it during mapping.
type inboundCfgWire struct {
	Subnet           string         `json:"subnet"`
	ServerPrivateKey string         `json:"serverPrivateKey"`
	ServerPublicKey  string         `json:"serverPublicKey"` // unused on agent
	Obfuscation      obfuscationCfg `json:"obfuscation"`
	// ListenPort is the UDP port the awg-quick interface should bind to.
	// Injected by panel-backend from inbound.port (binding-level field
	// above the protocol config) — see apps/panel-backend/src/modules/
	// inbounds/inbounds.queue.ts. When zero on the wire, we fall back to
	// the caller-supplied listenPort (install-time default). Caught live
	// cycle #6 2026-05-12: client wgconf advertised Endpoint=:443 but
	// the server bound 51820, all UDP packets fell on the floor.
	ListenPort int `json:"listenPort,omitempty"`
}

type obfuscationCfg struct {
	Jc   int    `json:"jc"`
	Jmin int    `json:"jmin"`
	Jmax int    `json:"jmax"`
	S1   int    `json:"s1"`
	S2   int    `json:"s2"`
	S3   int    `json:"s3"`
	S4   int    `json:"s4"`
	H1   uint32 `json:"h1"`
	H2   uint32 `json:"h2"`
	H3   uint32 `json:"h3"`
	H4   uint32 `json:"h4"`
}

// toInboundConfig maps wire onto the existing config.go InboundConfig.
// `Interface` and `ListenPort` are install-time identity (not in the wire),
// so the caller passes them in from the live adapter Config.
func (w inboundCfgWire) toInboundConfig(iface string, listenPort int) (InboundConfig, error) {
	addr, err := serverAddressFromSubnet(w.Subnet)
	if err != nil {
		return InboundConfig{}, err
	}
	// Prefer the port declared on the wire (per-inbound, set in panel UI);
	// fall back to the install-time default the caller passes in.
	port := listenPort
	if w.ListenPort > 0 {
		port = w.ListenPort
	}
	return InboundConfig{
		Interface:  iface,
		ListenPort: port,
		PrivateKey: w.ServerPrivateKey,
		Address:    addr,
		Jc:         w.Obfuscation.Jc,
		Jmin:       w.Obfuscation.Jmin,
		Jmax:       w.Obfuscation.Jmax,
		S1:         w.Obfuscation.S1,
		S2:         w.Obfuscation.S2,
		S3:         w.Obfuscation.S3,
		S4:         w.Obfuscation.S4,
		H1:         w.Obfuscation.H1,
		H2:         w.Obfuscation.H2,
		H3:         w.Obfuscation.H3,
		H4:         w.Obfuscation.H4,
	}, nil
}

// serverAddressFromSubnet picks the first usable host of the subnet for the
// server's tunnel IP — by convention `.1`. Input "10.0.0.0/24" → "10.0.0.1/24".
func serverAddressFromSubnet(subnet string) (string, error) {
	ip, ipnet, err := net.ParseCIDR(subnet)
	if err != nil {
		return "", fmt.Errorf("parse subnet %q: %w", subnet, err)
	}
	v4 := ip.To4()
	if v4 == nil {
		return "", fmt.Errorf("subnet %q is not IPv4", subnet)
	}
	host := make(net.IP, 4)
	copy(host, v4)
	host[3]++
	ones, _ := ipnet.Mask.Size()
	return fmt.Sprintf("%s/%d", host.String(), ones), nil
}

// diffKind classifies a transition between two InboundConfig values:
//   - diffNone: byte-equivalent, no work
//   - diffSubnet: subnet/address changed — reject when peers exist (cannot
//     re-allocate without rotating every client)
//   - diffSyncconf: only S1-S4 / Jc/Jmin/Jmax changed — `awg syncconf` reloads
//     these without bouncing the interface
//   - diffRestart: H1-H4 / PrivateKey / ListenPort / Interface changed —
//     these are interface-immutable, syncconf can't apply them, full restart
//     required (admins are warned in panel UI)
type diffKind int

const (
	diffNone diffKind = iota
	diffSyncconf
	diffRestart
	diffSubnet
)

// classifyDiff compares old vs new and returns the strictest action required.
// "Strictest" means: subnet > restart > syncconf > none — if multiple changes
// happen at once we pick the one demanding the heaviest reload.
func classifyDiff(old, new InboundConfig) diffKind {
	if old.Address != new.Address {
		return diffSubnet
	}
	if old.PrivateKey != new.PrivateKey ||
		old.ListenPort != new.ListenPort ||
		old.Interface != new.Interface ||
		old.H1 != new.H1 ||
		old.H2 != new.H2 ||
		old.H3 != new.H3 ||
		old.H4 != new.H4 {
		return diffRestart
	}
	if old.S1 != new.S1 || old.S2 != new.S2 || old.S3 != new.S3 || old.S4 != new.S4 ||
		old.Jc != new.Jc || old.Jmin != new.Jmin || old.Jmax != new.Jmax {
		return diffSyncconf
	}
	return diffNone
}
