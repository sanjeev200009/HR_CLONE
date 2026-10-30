import { useState } from "react";
import { Text, TextInput, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { useSignIn, useSignUp } from "@clerk/expo";
import { s } from "./ui";

// Employees are pre-created by their company admin as a member row keyed on email.
// Here they get a Clerk account for that same email; convex members.claim binds the
// two on first sign-in.
//
// Sign-in is an emailed 6-digit code. Sign-up also needs a password because this
// Clerk instance currently requires one (min 15 chars) — turn that off under
// Clerk dashboard > User & Authentication > Password and the field disappears.
//
// @clerk/expo v4 RETURNS errors rather than throwing them, so every call below is
// checked, not try/caught.
export default function SignIn() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  const [step, setStep] = useState<"email" | "code">("email");
  const [newAccount, setNewAccount] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Show Clerk's own wording. "Something went wrong" on a login screen is how you
  // lose a pilot customer.
  const say = (e: { longMessage?: string; message: string }) =>
    setErr(e.longMessage ?? e.message);

  async function sendCode() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await signIn.create({ identifier: email.trim().toLowerCase() });
      if (created.error) {
        // No Clerk account for this email yet -> first-ever sign-in, so sign up.
        if (created.error.code === "form_identifier_not_found") setNewAccount(true);
        else say(created.error);
        return;
      }
      const sent = await signIn.emailCode.sendCode();
      if (sent.error) return say(sent.error);
      setNewAccount(false);
      setStep("code");
    } finally {
      setBusy(false);
    }
  }

  async function createAccount() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await signUp.create({
        emailAddress: email.trim().toLowerCase(),
        password,
      });
      if (created.error) return say(created.error);
      const sent = await signUp.verifications.sendEmailCode();
      if (sent.error) return say(sent.error);
      setStep("code");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (newAccount) {
        const v = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        if (v.error) return say(v.error);
        const f = await signUp.finalize();
        if (f.error) return say(f.error);
      } else {
        const v = await signIn.emailCode.verifyCode({ code: code.trim() });
        if (v.error) return say(v.error);
        const f = await signIn.finalize();
        if (f.error) return say(f.error);
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <View style={s.screen}>
        <Text style={s.h1}>Check your email</Text>
        <Text style={s.muted}>We sent a 6-digit code to {email}.</Text>
        <Text style={s.label}>Code</Text>
        <TextInput
          style={s.input}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoFocus
          maxLength={6}
          textContentType="oneTimeCode"
        />
        {err && <Text style={s.error}>{err}</Text>}
        <TouchableOpacity style={s.button} onPress={verify} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Continue</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setStep("email");
            setCode("");
            setErr(null);
          }}
        >
          <Text style={s.link}>Use a different email</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <Text style={s.h1}>AttendanceHR</Text>
      <Text style={s.muted}>
        {newAccount
          ? "First time here — set a password for your work email."
          : "Sign in with your work email."}
      </Text>

      <Text style={s.label}>Work email</Text>
      <TextInput
        style={s.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!newAccount}
      />

      {newAccount && (
        <>
          <Text style={s.label}>Password (at least 15 characters)</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
          />
        </>
      )}

      {err && <Text style={s.error}>{err}</Text>}

      <TouchableOpacity
        style={s.button}
        onPress={newAccount ? createAccount : sendCode}
        disabled={busy || !email.trim()}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={s.buttonText}>{newAccount ? "Create account" : "Send me a code"}</Text>
        )}
      </TouchableOpacity>

      {newAccount && (
        <TouchableOpacity
          onPress={() => {
            setNewAccount(false);
            setPassword("");
            setErr(null);
          }}
        >
          <Text style={s.link}>Back</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
