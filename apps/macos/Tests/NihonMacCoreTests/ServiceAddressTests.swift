import Foundation
import NihonMacCore
import Testing

@Suite("Service address")
struct ServiceAddressTests {
    @Test("defaults to the published loopback port when the setting is unset or empty")
    func defaults() {
        #expect(ServiceAddress.resolve(setting: nil) == URL(string: "http://127.0.0.1:4000"))
        #expect(ServiceAddress.resolve(setting: "  ") == URL(string: "http://127.0.0.1:4000"))
    }

    @Test("accepts loopback IP addresses", arguments: [
        ("http://127.0.0.1:4100", "http://127.0.0.1:4100"),
        ("http://127.0.0.1:4100/", "http://127.0.0.1:4100"),
        ("https://127.1.2.3:8443", "https://127.1.2.3:8443"),
        ("http://[::1]:4000", "http://[::1]:4000"),
    ])
    func loopback(setting: String, expected: String) {
        #expect(ServiceAddress.resolve(setting: setting)?.absoluteString == expected)
    }

    @Test("refuses LAN and local-network names, other schemes, paths, and credentials", arguments: [
        "http://192.168.1.10:4000",
        "http://nihon.local:4000",
        "http://localhost:4000",
        "http://0.0.0.0:4000",
        "http://127.0.0.256:4000",
        "ftp://127.0.0.1",
        "http://127.0.0.1:4000/api",
        "http://user:secret@127.0.0.1:4000",
        "http://127.0.0.1:4000?x=1",
        "127.0.0.1:4000",
    ])
    func refused(setting: String) {
        #expect(ServiceAddress.resolve(setting: setting) == nil)
    }
}
