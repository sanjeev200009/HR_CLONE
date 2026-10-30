import { Show } from "@clerk/expo";
import SignIn from "./SignIn";
import Home from "./Home";

// @clerk/expo v4 uses <Show when="..."> rather than <SignedIn>/<SignedOut>.
export default function Gate() {
  return (
    <>
      <Show when="signed-out">
        <SignIn />
      </Show>
      <Show when="signed-in">
        <Home />
      </Show>
    </>
  );
}
