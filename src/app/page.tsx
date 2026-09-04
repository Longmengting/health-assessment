import { APP_NAME } from "@/lib/app-config";

export default function HomePage() {
  return (
    <main>
      <section aria-labelledby="page-title">
        <p className="eyebrow">Educational wellness guidance</p>
        <h1 id="page-title">{APP_NAME}</h1>
        <p>
          Explore personalized health estimates designed to help you prepare for a more informed conversation.
        </p>
        <p className="notice" role="note">
          This tool provides educational estimates and is not medical advice.
        </p>
      </section>
    </main>
  );
}
