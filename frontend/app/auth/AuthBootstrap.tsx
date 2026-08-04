"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface AccountData {
  id: string;
  name: string | null;
  email: string | null;
  timezone: string;
  conversationId: string;
  onboardingComplete: boolean;
  onboardingCompletedAt: string | null;
  onboardingRequired: boolean;
  isNewUser: boolean;
  persona: {
    name: string;
    voiceDirection:
      | "default"
      | "softer"
      | "firmer"
      | "playful"
      | "nurturing"
      | "intimate";
    customStyle: string;
    preferredUserName: string | null;
    endearmentPreference: string | null;
    boundaries: string[];
    version: number;
  };
}

interface AuthSessionValue {
  account: AccountData | null;
  refreshAccount: () => Promise<AccountData>;
}

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-[var(--bg)]">
      <div className="flex items-center gap-2" aria-label="Loading account">
        <span className="h-1.5 w-1.5 animate-typing-1 rounded-full bg-[var(--amber)]" />
        <span className="h-1.5 w-1.5 animate-typing-2 rounded-full bg-[var(--amber)]" />
        <span className="h-1.5 w-1.5 animate-typing-3 rounded-full bg-[var(--amber)]" />
      </div>
    </div>
  );
}

export default function AuthBootstrap({ children }: { children: ReactNode }) {
  const { getAccessTokenSilently, isAuthenticated, isLoading } = useAuth0();
  const pathname = usePathname();
  const router = useRouter();
  const [account, setAccount] = useState<AccountData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  const refreshAccount = useCallback(async (): Promise<AccountData> => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    if (!apiUrl) {
      throw new Error("NEXT_PUBLIC_API_URL is not configured");
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const token = await getAccessTokenSilently();
      const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.data) {
        throw new Error(
          payload?.error?.message ?? "Cantarella could not open your account.",
        );
      }

      const nextAccount = payload.data as AccountData;
      setAccount(nextAccount);
      setStatus("ready");
      return nextAccount;
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Cantarella could not open your account.",
      );
      throw error;
    }
  }, [getAccessTokenSilently]);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      setAccount(null);
      setStatus("idle");
      return;
    }

    void refreshAccount().catch(() => undefined);
  }, [isAuthenticated, isLoading, refreshAccount]);

  useEffect(() => {
    if (status !== "ready" || !account) return;

    if (account.onboardingRequired && pathname !== "/onboarding") {
      router.replace("/onboarding");
      return;
    }

    if (
      !account.onboardingRequired &&
      ["/", "/auth/login", "/onboarding"].includes(pathname)
    ) {
      router.replace("/chat");
    }
  }, [account, pathname, router, status]);

  const contextValue = useMemo(
    () => ({ account, refreshAccount }),
    [account, refreshAccount],
  );

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <>{children}</>;

  if (status === "error") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--bg)] px-6">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border2)] bg-[var(--surface)] p-8 text-center">
          <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--text)]">
            Couldn&apos;t open Cantarella
          </h1>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={() => void refreshAccount().catch(() => undefined)}
            className="mt-6 rounded-lg bg-[var(--amber)] px-5 py-2.5 text-sm font-medium text-[#1A0F08]"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const redirecting =
    status === "ready" &&
    account !== null &&
    ((account.onboardingRequired && pathname !== "/onboarding") ||
      (!account.onboardingRequired &&
        ["/", "/auth/login", "/onboarding"].includes(pathname)));

  if (status !== "ready" || redirecting) return <LoadingScreen />;

  return (
    <AuthSessionContext.Provider value={contextValue}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionValue {
  const value = useContext(AuthSessionContext);

  if (!value) {
    throw new Error("useAuthSession must be used inside AuthBootstrap");
  }

  return value;
}
