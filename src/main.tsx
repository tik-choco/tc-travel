import { render } from "preact";
import "./index.css";
import "./styles/theme.css";
import "./lib/common.i18n";
import { getProfile, touchStreak } from "./lib/personal";
import { applyTheme } from "./lib/theme";
import { App } from "./app";
import { writeAppManifest } from "./lib/drive/appManifest";
import { BUS_VERSION } from "./lib/drive/sharedBus";

// Set the theme before the first render so the app never flashes the wrong scheme.
applyTheme(getProfile().theme ?? "light");
touchStreak();

render(<App />, document.getElementById("app")!);

writeAppManifest({
  app: "tc-travel",
  busVersion: BUS_VERSION,
  publishes: ["folder-export"],
  consumes: ["drive-index", "character-index"],
  reads: [],
});
