import { Component } from "react";
import { reportClientError } from "../lib/api";

// Catches a crash anywhere in the page, saves it in the error log and asks the app to show the Error page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    reportClientError({
      kind: "render",
      message: String((error && error.message) || error),
      stack: `${(error && error.stack) || ""}\n--- component stack ---${(info && info.componentStack) || ""}`,
    }).then((ref) => this.props.onError(ref));
  }

  componentDidUpdate(prev) {
    // A new page was opened (e.g. the Error page itself): render normally again.
    if (this.state.crashed && prev.resetKey !== this.props.resetKey) this.setState({ crashed: false });
  }

  render() {
    return this.state.crashed ? this.props.fallback : this.props.children;
  }
}
