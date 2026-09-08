// Placeholder Privacy Policy draft — pending review by legal counsel before publishing.
import type { Metadata } from "next";
import { AppBrand } from "@/components/app-brand";

export const metadata: Metadata = {
  title: "Privacy Policy | SitecoreAI Content Transfer",
  description:
    "Privacy Policy for the SitecoreAI Content Transfer application, provided by Americaneagle.com.",
};

const LAST_UPDATED = "September 7, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center gap-3 max-w-3xl">
          <AppBrand />
        </div>
      </div>

      <div className="container mx-auto px-6 py-10 max-w-3xl space-y-8">
        <div>
          <h2 className="text-2xl font-semibold">Privacy Policy</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Last updated: {LAST_UPDATED}
          </p>
        </div>

        <section className="space-y-3 text-sm leading-relaxed">
          <p>
            This Privacy Policy describes how Americaneagle.com
            (&quot;Americaneagle.com&quot;, &quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;) handles data in connection with the SitecoreAI
            Content Transfer application (the &quot;App&quot;), a Contribution
            distributed on the Sitecore Marketplace.
          </p>
          <p>
            The Sitecore Marketplace platform itself, including your
            Marketplace account and platform-level data, is governed by
            Sitecore&apos;s own Privacy Policy and Data Processing Addendum,
            available at{" "}
            <a
              href="https://www.sitecore.com/legal/privacy-policy"
              className="underline underline-offset-2"
            >
              sitecore.com/legal/privacy-policy
            </a>{" "}
            and{" "}
            <a
              href="https://www.sitecore.com/legal/dpa"
              className="underline underline-offset-2"
            >
              sitecore.com/legal/dpa
            </a>
            . This policy covers only the App itself.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">
            1. What the App Processes
          </h3>
          <p className="text-sm leading-relaxed">
            The App lets an authorized user transfer Sitecore content items
            (which may include Personal Data contained within that content)
            between source and destination SitecoreAI environments that the
            user already has access to. This content is read from and written
            to those environments directly, via the Sitecore Marketplace SDK,
            for the sole purpose of completing the transfer the user
            initiates.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">
            2. No Server-Side Storage
          </h3>
          <p className="text-sm leading-relaxed">
            The App runs entirely in your browser. Americaneagle.com does not
            operate a backend server or database for the App, and the App
            does not persist transfer history or content outside of the
            transfer session itself. Content in transit exists only for the
            duration required to move it from the source to the destination
            environment.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">
            3. Data Shared with Sitecore
          </h3>
          <p className="text-sm leading-relaxed">
            Because the App operates through the Sitecore Marketplace SDK,
            your interactions necessarily pass through Sitecore&apos;s
            Marketplace platform. Sitecore&apos;s handling of that data is
            described in Sitecore&apos;s own Privacy Policy and DPA linked
            above.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">4. Your Responsibilities</h3>
          <p className="text-sm leading-relaxed">
            If the content you transfer using the App contains Personal Data,
            you are responsible for ensuring you have a lawful basis to
            process and transfer that data, consistent with your own
            organization&apos;s privacy obligations.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">5. Changes to This Policy</h3>
          <p className="text-sm leading-relaxed">
            We may update this Privacy Policy from time to time. Material
            changes will be reflected by an updated &quot;Last updated&quot;
            date on this page.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">6. Contact</h3>
          <p className="text-sm leading-relaxed">
            Questions about this Privacy Policy can be directed to{" "}
            <span className="font-mono">[placeholder contact email]</span>.
          </p>
        </section>
      </div>
    </div>
  );
}
