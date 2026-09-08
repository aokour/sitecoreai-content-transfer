// Placeholder Terms of Use draft — pending review by legal counsel before publishing.
import type { Metadata } from "next";
import { AppBrand } from "@/components/app-brand";

export const metadata: Metadata = {
  title: "Terms of Use | SitecoreAI Content Transfer",
  description:
    "Terms of Use for the SitecoreAI Content Transfer application, provided by Americaneagle.com.",
};

const LAST_UPDATED = "September 7, 2026";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center gap-3 max-w-3xl">
          <AppBrand />
        </div>
      </div>

      <div className="container mx-auto px-6 py-10 max-w-3xl space-y-8">
        <div>
          <h2 className="text-2xl font-semibold">Terms of Use</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Last updated: {LAST_UPDATED}
          </p>
        </div>

        <section className="space-y-3 text-sm leading-relaxed">
          <p>
            These Terms of Use (&quot;Terms&quot;) govern your access to and
            use of the SitecoreAI Content Transfer application (the
            &quot;App&quot;), provided by Americaneagle.com
            (&quot;Americaneagle.com&quot;, &quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;). By accessing or using the App, you agree to be
            bound by these Terms. If you do not agree, do not use the App.
          </p>
          <p>
            The App is distributed as a Contribution on the Sitecore
            Marketplace. Your use of the App within the Sitecore Marketplace
            is also governed by Sitecore&apos;s own Marketplace Developer
            Terms of Use, the Sitecore Shared Source License, and
            Sitecore&apos;s Data Processing Addendum, available at{" "}
            <a
              href="https://www.sitecore.com/legal/dpa"
              className="underline underline-offset-2"
            >
              sitecore.com/legal/dpa
            </a>
            . In the event of a conflict between these Terms and
            Sitecore&apos;s Marketplace terms as they relate to the
            Marketplace platform itself, Sitecore&apos;s terms control.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">1. Acceptance of Terms</h3>
          <p className="text-sm leading-relaxed">
            We may update these Terms from time to time. Material changes will
            be reflected by an updated &quot;Last updated&quot; date on this
            page. Continued use of the App after changes take effect
            constitutes acceptance of the revised Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">2. Permitted Use</h3>
          <p className="text-sm leading-relaxed">
            The App is intended to help authorized users transfer content
            between SitecoreAI environments to which they already have
            legitimate access. You may use the App only for its intended
            purpose, only with environments you are authorized to access, and
            in compliance with all applicable laws and Sitecore&apos;s
            Marketplace policies.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">3. Your Responsibilities</h3>
          <p className="text-sm leading-relaxed">
            You are responsible for maintaining the confidentiality of your
            Sitecore and Marketplace credentials, for all activity performed
            using your account, and for ensuring that any content you
            transfer using the App complies with applicable law and does not
            infringe the rights of any third party.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">
            4. Disclaimer of Warranties
          </h3>
          <p className="text-sm leading-relaxed">
            THE APP IS PROVIDED &quot;AS IS&quot; AND &quot;AS
            AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR
            IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
            NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE APP WILL BE
            UNINTERRUPTED, ERROR-FREE, OR THAT ALL TRANSFERRED CONTENT WILL BE
            ACCURATE OR COMPLETE.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">
            5. Limitation of Liability
          </h3>
          <p className="text-sm leading-relaxed">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, AMERICANEAGLE.COM SHALL
            NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
            CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, PROFITS,
            OR BUSINESS, ARISING OUT OF OR RELATED TO YOUR USE OF THE APP.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">6. Termination</h3>
          <p className="text-sm leading-relaxed">
            We may suspend or discontinue the App, or your access to it, at
            any time, with or without notice, including if Sitecore removes
            the App from the Marketplace.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">7. Governing Law</h3>
          <p className="text-sm leading-relaxed">
            [Placeholder — governing law and venue to be confirmed with
            legal counsel.]
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-lg font-semibold">8. Contact</h3>
          <p className="text-sm leading-relaxed">
            Questions about these Terms can be directed to{" "}
            <span className="font-mono">[placeholder contact email]</span>.
          </p>
        </section>
      </div>
    </div>
  );
}
