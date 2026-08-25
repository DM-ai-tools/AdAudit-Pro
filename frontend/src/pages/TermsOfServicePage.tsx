import { Link } from 'react-router-dom';
import { LegalPageLayout, LegalSection } from '../components/layout/LegalPageLayout';

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated="July 23, 2026">
      <LegalSection title="1. Agreement to Terms">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use of AdAudit Pro
          websites, applications, and related services (the &quot;Service&quot;). By accessing or
          using the Service, you agree to these Terms and our{' '}
          <Link to="/privacy" className="text-teal hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
        <p>If you are using the Service on behalf of an organization, you represent that you have authority to bind that organization to these Terms.</p>
      </LegalSection>

      <LegalSection title="2. Description of the Service">
        <p>
          AdAudit Pro provides Google Ads account auditing, reporting, health scoring, roadmaps, and
          AI-assisted optimization suggestions. Features may change over time as we improve the
          product.
        </p>
      </LegalSection>

      <LegalSection title="3. Accounts and Access">
        <ul className="list-disc pl-5 space-y-2">
          <li>You must provide accurate account information and keep credentials secure.</li>
          <li>You are responsible for activity under your account.</li>
          <li>
            Connecting Google Ads requires your authorization. Access is typically read-only for
            auditing; you remain responsible for changes made in Google Ads.
          </li>
          <li>We may suspend or terminate accounts that violate these Terms or pose security risk.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Acceptable Use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>Use the Service for unlawful, deceptive, or harmful purposes.</li>
          <li>Attempt to reverse engineer, scrape, or disrupt the Service or its infrastructure.</li>
          <li>Share login credentials or circumvent access controls.</li>
          <li>Upload or transmit malware, spam, or content you do not have rights to use.</li>
          <li>Misrepresent AI-generated suggestions as guaranteed performance outcomes.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Google Ads and Third-Party Services">
        <p>
          The Service depends on Google Ads APIs and other third-party providers (including AI
          vendors). Their availability, policies, and terms are outside our control. We are not
          liable for outages, API changes, or actions taken by Google or other providers.
        </p>
      </LegalSection>

      <LegalSection title="6. AI Recommendations and No Guarantee">
        <p>
          Audit findings, financial estimates, health scores, roadmaps, and optimized ad copy are
          analytical suggestions based on available data and AI models. They are not guarantees of
          results. Actual advertising performance depends on many factors outside our control. You
          are solely responsible for reviewing and approving any changes before publishing in Google
          Ads.
        </p>
      </LegalSection>

      <LegalSection title="7. Intellectual Property">
        <p>
          AdAudit Pro, including its software, branding, and documentation, is owned by us or our
          licensors. You retain ownership of your account content and Google Ads data. You grant us a
          limited license to process that content solely to provide the Service.
        </p>
      </LegalSection>

      <LegalSection title="8. Subscriptions and Fees">
        <p>
          Paid plans, if offered, are billed according to the pricing and terms shown at purchase.
          Fees are generally non-refundable except where required by law or expressly stated. We may
          change pricing with notice for future billing periods.
        </p>
      </LegalSection>

      <LegalSection title="9. Confidentiality">
        <p>
          We treat your Google Ads and account data as confidential and use it to provide the
          Service. You agree not to disclose non-public Service features, pricing for private offers,
          or other confidential information you receive from us.
        </p>
      </LegalSection>

      <LegalSection title="10. Disclaimers">
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES
          OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR
          PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED,
          ERROR-FREE, OR THAT AUDIT RESULTS WILL BE COMPLETE OR ACCURATE IN EVERY CASE.
        </p>
      </LegalSection>

      <LegalSection title="11. Limitation of Liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, ADAUDIT PRO AND ITS AFFILIATES WILL NOT BE LIABLE
          FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF
          PROFITS, REVENUE, DATA, OR GOODWILL. OUR TOTAL LIABILITY FOR CLAIMS ARISING FROM THE SERVICE
          WILL NOT EXCEED THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE TWELVE (12) MONTHS BEFORE
          THE CLAIM.
        </p>
      </LegalSection>

      <LegalSection title="12. Indemnification">
        <p>
          You agree to indemnify and hold harmless AdAudit Pro from claims arising out of your use of
          the Service, your Google Ads campaigns, or your violation of these Terms or applicable law.
        </p>
      </LegalSection>

      <LegalSection title="13. Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate access if you
          breach these Terms. Provisions that by nature should survive (including IP, disclaimers,
          and liability limits) will survive termination.
        </p>
      </LegalSection>

      <LegalSection title="14. Changes to Terms">
        <p>
          We may update these Terms periodically. The &quot;Last updated&quot; date will change when
          we do. Continued use after updates constitutes acceptance of the revised Terms.
        </p>
      </LegalSection>

      <LegalSection title="15. Governing Law">
        <p>
          These Terms are governed by the laws of Victoria, Australia, without regard to conflict of
          law principles, unless mandatory consumer protections in your jurisdiction require
          otherwise.
        </p>
      </LegalSection>

      <LegalSection title="16. Contact">
        <p>
          Questions about these Terms:{' '}
          <a href="mailto:hello@adauditpro.com" className="text-teal hover:underline">
            hello@adauditpro.com
          </a>
          . Privacy details are in our{' '}
          <Link to="/privacy" className="text-teal hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
