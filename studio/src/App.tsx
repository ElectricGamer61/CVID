import { useEffect, useState } from "react";
import Editor from "./Editor";
import Home from "./Home";

// Two screens, addressed by the hash so a reload or a bookmark lands back in the project:
//   #/            your projects
//   #/p/<id>      the Cut room for one project
function route(): { page: "home" } | { page: "edit"; id: string } {
  const m = location.hash.match(/^#\/p\/([0-9a-f]{8})/);
  return m ? { page: "edit", id: m[1] } : { page: "home" };
}

export function go(hash: string) {
  location.hash = hash;
}

export default function App() {
  const [r, setR] = useState(route);
  useEffect(() => {
    const on = () => setR(route());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r.page === "edit" ? <Editor key={r.id} id={r.id} /> : <Home />;
}
