import { render } from "preact";
import "./index.css";
import "./styles/theme.css";
import "./lib/common.i18n";
import { touchStreak } from "./lib/personal";
import { App } from "./app";

touchStreak();

render(<App />, document.getElementById("app")!);
