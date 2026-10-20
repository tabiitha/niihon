import AppKit
import Darwin
import NihonMacCore
import SwiftUI

/// Measurement mode, enabled by the `--probe` launch argument and used by apps/macos/scripts/measure.sh.
/// It records the time from process start to the first connected window, then opens and closes a window
/// twenty times while moving through every space, records the memory footprint after each cycle, prints
/// one JSON line to standard output, and quits. Without the argument, nothing here runs.
@MainActor
final class StartupProbe {
    static let shared: StartupProbe? = CommandLine.arguments.contains("--probe") ? StartupProbe() : nil

    /// Twenty by default; the launch argument `-NihonProbeCycles <count>` changes it to observe longer runs.
    static let cycles: Int = {
        let cycles = UserDefaults.standard.integer(forKey: "NihonProbeCycles")
        return cycles > 0 ? cycles : 20
    }()

    private var launchMilliseconds: Double?
    private var driving = false
    private var connections = 0

    /// Called by every window when its check succeeds.
    func windowConnected() {
        if launchMilliseconds == nil {
            launchMilliseconds = (Date().timeIntervalSince1970 - Self.processStartTime()) * 1000
        }
        connections += 1
    }

    /// Run by the first window only; `select` changes that window's space.
    func drive(openWindow: OpenWindowAction, select: @escaping (Space) -> Void) async {
        guard !driving else { return }
        driving = true
        _ = await connection(after: 0)
        try? await Task.sleep(for: .milliseconds(500))
        let baseline = Self.footprintMegabytes()
        var footprints: [Double] = []
        var missed = 0
        for _ in 0..<Self.cycles {
            let before = Set(NSApp.windows.map(ObjectIdentifier.init))
            let connectionsBefore = connections
            openWindow(id: ShellView.windowID)
            if await !connection(after: connectionsBefore) {
                missed += 1
            }
            for space in Space.allCases {
                select(space)
                try? await Task.sleep(for: .milliseconds(20))
            }
            NSApp.windows.filter { !before.contains(ObjectIdentifier($0)) }.forEach { $0.close() }
            try? await Task.sleep(for: .milliseconds(200))
            footprints.append(Self.footprintMegabytes())
        }
        select(.home)
        let report: [String: Any] = [
            "launchToConnectedMs": Int((launchMilliseconds ?? -1).rounded()),
            "cycles": Self.cycles,
            "footprintBaselineMB": Self.decimal(baseline),
            "footprintAfterCycleMB": footprints.map(Self.decimal),
            "windowsLeft": NSApp.windows.filter(\.isVisible).count,
            "windowsNotConnectedWithin5s": missed,
        ]
        let data = try! JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
        FileHandle.standardOutput.write(data + Data("\n".utf8))
        NSApp.terminate(nil)
    }

    /// Waits up to five seconds for a window to connect after `count` connections; false on timeout.
    private func connection(after count: Int) async -> Bool {
        for _ in 0..<500 {
            if connections > count { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return false
    }

    /// Process start, in seconds since 1970, from the kernel's process table.
    private static func processStartTime() -> Double {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&name, u_int(name.count), &info, &size, nil, 0) == 0 else { return Date().timeIntervalSince1970 }
        let start = info.kp_proc.p_un.__p_starttime
        return Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
    }

    /// Physical footprint, as shown by Activity Monitor's Memory column, in megabytes.
    private static func footprintMegabytes() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return -1 }
        return Double(info.phys_footprint) / 1_048_576
    }

    /// A megabyte value with one decimal, written as such in the JSON report.
    private static func decimal(_ megabytes: Double) -> NSDecimalNumber {
        NSDecimalNumber(string: String(format: "%.1f", megabytes))
    }
}
