import UIKit
import Capacitor

class ViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        // Disable rubber-band bounce so sticky headers don't reveal
        // dead space above them when the user overscrolls at the top.
        webView?.scrollView.bounces = false
    }
}
