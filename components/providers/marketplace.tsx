"use client";

import {
  type ApplicationContext,
  ClientSDK,
} from "@sitecore-marketplace-sdk/client";
import { XMC } from "@sitecore-marketplace-sdk/xmc";
import type React from "react";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { AeLogoAnimated } from "@/components/AeLogoAnimated";

interface ClientSDKProviderProps {
  children: ReactNode;
}

const ClientSDKContext = createContext<ClientSDK | null>(null);
const AppContextContext = createContext<ApplicationContext | null>(null);

export const MarketplaceProvider: React.FC<ClientSDKProviderProps> = ({
  children,
}) => {
  const [client, setClient] = useState<ClientSDK | null>(null);
  const [appContext, setAppContext] = useState<ApplicationContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "loading" → "fading" → "done" as SDK becomes ready
  const [overlayStage, setOverlayStage] = useState<
    "loading" | "fading" | "done"
  >("loading");
  // Tracks whether enough time has passed for the full logo animation to play (~3.2s)
  const [minTimeReady, setMinTimeReady] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    if (client) {
      client.query("application.context").then((res) => {
        if (res?.data) {
          setAppContext(res.data);
          console.log("appContext", res.data);
        }
      });
    }
  }, [client]);

  useEffect(() => {
    const init = async () => {
      const config = {
        target: window.parent,
        modules: [XMC],
        timeout: 10 * 60 * 1000, // 10 min — large binary chunks (90–200 MB) take 15–60s through the PostMessage bridge
      };
      try {
        const client = await ClientSDK.init(config);
        setClient(client);
      } catch (error) {
        console.error("Error initializing client SDK", error);
        setError("Error initializing client SDK");
      }
    };

    init();
  }, []);

  // Minimum display time — enough for the full entrance animation (~2.3s) + brief pause
  useEffect(() => {
    const t = setTimeout(() => setMinTimeReady(true), 2100);
    return () => clearTimeout(t);
  }, []);

  // Mark SDK ready once both client and appContext are set
  useEffect(() => {
    if (client && appContext) {
      setTimeout(() => setSdkReady(true), 0);
    }
  }, [client, appContext]);

  // Start fade only when BOTH the animation has played AND the SDK is ready
  useEffect(() => {
    if (sdkReady && minTimeReady) {
      const t1 = setTimeout(() => setOverlayStage("fading"), 0);
      const t2 = setTimeout(() => setOverlayStage("done"), 500);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [sdkReady, minTimeReady]);

  if (error) {
    return (
      <div>
        <h1>Error initializing Marketplace SDK</h1>
        <div>{error}</div>
        <div>
          Please check if the client SDK is loaded inside Sitecore Marketplace
          parent window and you have properly set your app&apos;s extension
          points.
        </div>
      </div>
    );
  }

  return (
    <>
      {overlayStage !== "done" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background pointer-events-none"
          style={{
            opacity: overlayStage === "fading" ? 0 : 1,
            transition: "opacity 0.5s ease-out",
          }}
        >
          <AeLogoAnimated className="w-72" animate={true} />
        </div>
      )}
      {client && appContext && (
        <ClientSDKContext.Provider value={client}>
          <AppContextContext.Provider value={appContext}>
            {children}
          </AppContextContext.Provider>
        </ClientSDKContext.Provider>
      )}
    </>
  );
};

export const useMarketplaceClient = () => {
  const context = useContext(ClientSDKContext);
  if (!context) {
    throw new Error(
      "useMarketplaceClient must be used within a ClientSDKProvider",
    );
  }
  return context;
};

export const useAppContext = () => {
  const context = useContext(AppContextContext);
  if (!context) {
    throw new Error("useAppContext must be used within a ClientSDKProvider");
  }
  return context;
};
