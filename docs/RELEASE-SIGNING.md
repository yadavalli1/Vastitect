# Signing the Vastitecture installers

The release workflow (`.github/workflows/release.yml`) builds unsigned installers until the secrets
below are added under Settings → Secrets and variables → Actions. Each platform switches on by itself,
so they can be set up one at a time. Pull-request builds never receive these secrets.

Every release, signed or not, also gets `SHA256SUMS.txt` and a GitHub build provenance attestation for
each file. Both are free. Anyone can check a download with
`gh attestation verify <file> --repo yadavalli1/Vastitect`.

## macOS: Developer ID and notarisation

Needed so Gatekeeper opens the app without the "unidentified developer" warning.

1. Join the Apple Developer Program (99 USD per membership year, per Apple; individuals can enrol).
2. As the Account Holder, create a **Developer ID Application** certificate, export it with its private
   key as a `.p12`, and base64-encode it (`base64 -i cert.p12 | pbcopy`).
3. Create an App Store Connect API key (Users and Access → Integrations) for notarisation.

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the password used when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_API_KEY` | the API key ID |
| `APPLE_API_ISSUER` | the issuer ID |
| `APPLE_API_PRIVATE_KEY` | the full text of `AuthKey_<id>.p8` |

The older Apple ID route still works instead of the API key: `APPLE_ID`, `APPLE_PASSWORD` (an
app-specific password) and `APPLE_TEAM_ID`. With a certificate but neither notarisation method, the app
is signed but not notarised, and macOS still warns.

## Windows: Azure Artifact Signing (recommended)

Since June 2023 an OV certificate's private key must be kept on a hardware token or HSM, so a new OV
certificate can no longer be exported as a `.pfx` for CI. Azure Artifact Signing (formerly Trusted
Signing) signs in the cloud instead. Microsoft lists it at about 9.99 USD a month; individual developers
must be in the United States or Canada and validate with a government ID that shows an address. Billing
starts when the account is created and is not pro-rated, and free or trial Azure subscriptions are not
accepted.

1. In an Azure subscription, create an Artifact Signing account, complete identity validation
   (Individual), and create a Public Trust certificate profile.
2. Create an app registration with a client secret, and give it the
   **Artifact Signing Certificate Profile Signer** role on the account.

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `AZURE_CLIENT_ID` | the app registration's client ID |
| Secret | `AZURE_CLIENT_SECRET` | its client secret |
| Secret | `AZURE_TENANT_ID` | the directory (tenant) ID |
| Variable | `AZURE_SIGNING_ENDPOINT` | the account's endpoint, e.g. `https://wus2.codesigning.azure.net` |
| Variable | `AZURE_SIGNING_ACCOUNT` | the Artifact Signing account name |
| Variable | `AZURE_SIGNING_PROFILE` | the certificate profile name |

The workflow installs `artifact-signing-cli` 0.12.0 (the tool the Tauri signing guide uses) and has
Tauri call it for the app's `.exe` and the MSI.

A new signature starts with no SmartScreen reputation whichever route is used; warnings fade as
downloads build it up. EV certificates no longer skip this.

**Alternative:** an OV certificate issued before June 2023 that can still be exported as `.pfx`:
`WINDOWS_CERTIFICATE` (base64 `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD`. If both are set, Azure wins.

## Linux: GPG

Linux has no central signing authority. The workflow embeds a GPG signature in the AppImage and signs
`SHA256SUMS.txt` (as `SHA256SUMS.txt.asc`) with the same key.

1. Create a signing key: `gpg --quick-generate-key "Vastitecture releases <you@example.com>" ed25519 sign 2y`.
2. Export it: `gpg --armor --export-secret-keys <KEYID>`.
3. Publish the public key and its fingerprint somewhere served over HTTPS (the project site or README),
   so users can check against it.

| Secret | Value |
| --- | --- |
| `LINUX_GPG_PRIVATE_KEY` | the ASCII-armoured private key |
| `LINUX_GPG_PASSPHRASE` | its passphrase |

AppImage does not check the signature itself. Users check it with the AppImage `validate` tool, or check
`SHA256SUMS.txt.asc` with `gpg --verify`. The `.deb` is covered by the signed checksums.

## Auto-update key (separate from the above)

`plugins.updater.pubkey` in `apps/desktop/src-tauri/tauri.conf.json` is still a placeholder. Generate a
pair with `pnpm tauri signer generate`, put the public key there, and add `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. This only protects in-app updates; it does not replace OS signing.

## Checking a run

When a platform's secrets are set, the run fails if the result is not actually signed:
`codesign`, `stapler` and `spctl` on macOS, `Get-AuthenticodeSignature` on Windows, and the embedded
signature section on the AppImage.
