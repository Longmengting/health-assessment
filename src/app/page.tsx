import React from "react";

import { APP_NAME } from "../lib/app-config";
import AssessmentClient from "./assessment-client";

export default function HomePage() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Educational wellness estimate</p>
        <h1>{APP_NAME}</h1>
        <p className="lede">A practical starting point for your health goal, personalized in 4 short steps.</p>
        <a className="start-link" href="#assessment">Start my assessment</a>
        <p className="trust">Private by design · Takes about 2 minutes · No account required</p>
      </header>
      <div id="assessment"><AssessmentClient /></div>
      <footer>This educational estimate is not medical advice.</footer>
    </main>
  );
}
