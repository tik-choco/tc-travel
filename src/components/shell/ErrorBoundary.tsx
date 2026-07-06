import "./shell.i18n";
import { Component } from "preact";
import type { ComponentChildren } from "preact";
import { translate } from "../../lib/i18n";

interface Props {
  children: ComponentChildren;
}

interface State {
  error: Error | null;
}

/** Catches render errors in the room UI so a crash doesn't blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: unknown) {
    console.error("tc-travel: caught render error", error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div class="error-boundary-screen">
          <div class="panel error-boundary-panel">
            <p class="title-ornate">{translate("error.title")}</p>
            <p>{translate("error.body")}</p>
            <button
              type="button"
              class="btn btn-primary"
              onClick={() => {
                this.setState({ error: null });
                location.reload();
              }}
            >
              {translate("error.reload")}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
