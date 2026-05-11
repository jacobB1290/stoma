import React, { Component } from "react";

/**
 * Generic React error boundary.
 *
 * Behavior preserved from the inline class previously embedded in Board.jsx:
 *  - Logs the error and component stack via console.error.
 *  - Renders a small fallback panel with the error message and a "Try again"
 *    button that resets the boundary's local state.
 *
 * If a `fallback` prop is provided it overrides the default UI (no Try again
 * button is rendered in that case — the caller controls recovery).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Keep visible in prod for now; future PR can route through Sentry.
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg m-4">
          <h3 className="text-red-800 font-medium mb-2">
            Something went wrong
          </h3>
          <p className="text-red-600 text-sm">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
