import AppIntents
import UIKit

/**
 * iOS 16+ App Intent: "Wisper Flow — Dictate"
 *
 * This is what makes Wisper Flow show up as:
 *   - A Lock Screen widget
 *   - A Home Screen widget
 *   - An option in the iPhone 15 Pro Action Button
 *   - A Back Tap gesture
 *
 * When the user invokes it, we open the app directly into dictation mode.
 */
@available(iOS 16.0, *)
struct DictateIntent: AppIntent {
    static var title: LocalizedStringResource = "Dictate"
    static var description = IntentDescription("Open Wisper Flow and start dictating.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        // Bring the app to the foreground; main activity checks for the
        // "fromIntent" launch flag and jumps straight into record mode.
        // The URL is a hardcoded constant — safe to unwrap.
        guard let url = URL(string: "wisperflow://dictate") else {
            return .result()
        }
        UIApplication.shared.open(url)
        return .result()
    }
}
