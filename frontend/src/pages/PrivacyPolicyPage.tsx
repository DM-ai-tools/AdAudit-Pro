import { Link } from 'react-router-dom';
import { LegalPageLayout, LegalSection } from '../components/layout/LegalPageLayout';

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="July 23, 2026">
      <LegalSection title="1. Introduction">
        <p>
          AdAudit Pro (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) provides AI-powered Google Ads auditing
          tools. This Privacy Policy explains how we collect, use, store, and share information when
          you use our website and services (the &quot;Service&quot;).
        </p>
        <p>
          By using AdAudit Pro, you agree to the practices described in this policy. If you do not
          agree, please do not use the Service.
        </p>
      </LegalSection>

      <LegalSection title="2. Information We Collect">
        <p>
          <span className="text-white font-medium">Account information:</span> name, email address,
          and authentication details when you sign in (including via Google OAuth).
        </p>
        <p>
          <span className="text-white font-medium">Google Ads data:</span> with your authorization,
          we access read-only Google Ads account data needed to run audits (campaigns, keywords,
          search terms, ads, performance metrics, and related settings).
        </p>
        <p>
          <span className="text-white font-medium">Usage data:</span> pages visited, features used,
          device/browser type, and approximate location derived from IP address for security and
          product improvement.
        </p>
        <p>
          <span className="text-white font-medium">Communications:</span> messages you send us
          (support requests, feedback, or audit form details such as website URL and spend range).
        </p>
      </LegalSection>

      <LegalSection title="3. How We Use Information">
        <ul className="list-disc pl-5 space-y-2">
          <li>Provide, operate, and improve the Service (audits, reports, AI recommendations).</li>
          <li>Authenticate users and secure accounts.</li>
          <li>Generate audit findings, health scores, roadmaps, and optimized ad suggestions.</li>
          <li>Send service-related emails (audit links, account notices).</li>
          <li>Comply with legal obligations and prevent abuse or fraud.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Google User Data">
        <p>
          When you connect Google Ads, we use Google API services in accordance with Google&apos;s
          API Services User Data Policy, including Limited Use requirements. We only use Google Ads
          data to provide the audit and optimization features you request. We do not sell Google user
          data, and we do not use it for advertising unrelated to your request.
        </p>
        <p>
          You can revoke AdAudit Pro&apos;s access at any time in your{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal hover:underline"
          >
            Google Account permissions
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="5. AI Processing">
        <p>
          Some features send relevant account or creative context to third-party AI providers
          to generate analysis and recommendations. We configure these
          integrations to support the Service and do not use your data to train public models beyond
          what those providers&apos; terms allow for API customers.
        </p>
      </LegalSection>

      <LegalSection title="6. Sharing of Information">
        <p>We may share information with:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>Infrastructure and cloud providers that host the Service.</li>
          <li>AI and analytics vendors needed to deliver requested features.</li>
          <li>Professional advisors or authorities when required by law.</li>
          <li>A successor entity if we are involved in a merger, acquisition, or asset sale.</li>
        </ul>
        <p>We do not sell your personal information.</p>
      </LegalSection>

      <LegalSection title="7. Cookies and Similar Technologies">
        <p id="cookies">
          We use essential cookies and local storage for authentication, session continuity, and
          basic preferences. You can control cookies through your browser settings. Disabling
          essential storage may prevent login or audit features from working.
        </p>
      </LegalSection>

      <LegalSection title="8. Data Retention">
        <p>
          We retain account and audit data while your account is active and for a reasonable period
          afterward to provide the Service, resolve disputes, and meet legal requirements. You may
          request deletion of your account data by contacting us.
        </p>
      </LegalSection>

      <LegalSection title="9. Security">
        <p>
          We use industry-standard measures to protect information in transit and at rest. No method
          of transmission or storage is 100% secure; we cannot guarantee absolute security.
        </p>
      </LegalSection>

      <LegalSection title="10. Your Rights">
        <p>
          Depending on your location, you may have rights to access, correct, delete, or export your
          personal information, or to object to certain processing. Contact us to exercise these
          rights. You may also lodge a complaint with your local data protection authority.
        </p>
      </LegalSection>

      <LegalSection title="11. International Transfers">
        <p>
          The Service may be hosted or processed in countries other than your own. Where required,
          we take steps to ensure appropriate safeguards for cross-border transfers.
        </p>
      </LegalSection>

      <LegalSection title="12. Children">
        <p>
          The Service is not directed to children under 16. We do not knowingly collect personal
          information from children.
        </p>
      </LegalSection>

      <LegalSection title="13. Changes">
        <p>
          We may update this Privacy Policy from time to time. The &quot;Last updated&quot; date at
          the top will change when we do. Continued use of the Service after changes means you accept
          the updated policy.
        </p>
      </LegalSection>

      <LegalSection title="14. Contact">
        <p>
          Questions about this Privacy Policy:{' '}
          <a href="mailto:hello@adauditpro.com" className="text-teal hover:underline">
            hello@adauditpro.com
          </a>
          . See also our{' '}
          <Link to="/terms" className="text-teal hover:underline">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
