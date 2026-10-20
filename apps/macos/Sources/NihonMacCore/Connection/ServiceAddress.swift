import Foundation

/// Where the client finds the local Nihon service. The service runs separately (in Docker or with
/// `bun run start`); the client never starts it and only connects to this computer's loopback interface,
/// never to a LAN address or a `.local` name, which would require the Local Network permission.
public enum ServiceAddress {
    /// The published port of a default installation.
    public static let defaultURL = URL(string: "http://127.0.0.1:4000")!

    /// User-defaults key overriding the address, for example with the launch argument
    /// `-NihonServiceURL http://127.0.0.1:4100`.
    public static let settingKey = "NihonServiceURL"

    /// The service URL for a setting value: the default when unset or empty, the value when it is a plain
    /// `http` or `https` URL of a loopback IP address, otherwise `nil`.
    public static func resolve(setting: String?) -> URL? {
        guard let setting = setting?.trimmingCharacters(in: .whitespaces), !setting.isEmpty else {
            return defaultURL
        }
        guard
            var components = URLComponents(string: setting),
            let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
            let host = components.host, isLoopback(host),
            components.user == nil, components.password == nil,
            components.path.isEmpty || components.path == "/",
            components.query == nil, components.fragment == nil
        else {
            return nil
        }
        components.path = ""
        return components.url
    }

    /// Whether `host` is an IPv4 address of 127.0.0.0/8 or the IPv6 address `::1`.
    static func isLoopback(_ host: String) -> Bool {
        let host = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "::1" {
            return true
        }
        let octets = host.split(separator: ".", omittingEmptySubsequences: false)
        return octets.count == 4
            && octets.allSatisfy { $0.count <= 3 && UInt8($0) != nil }
            && octets.first == "127"
    }
}
