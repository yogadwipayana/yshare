import App from "@/components/App";

// The page itself is a static shell; login state is checked in the browser via /api/session.
export default function Home() {
  return <App />;
}
