# Publishing File Last Modified

This extension is ready for local VSIX packaging.

To publish it on the Visual Studio Marketplace:

1. Create a publisher at `https://marketplace.visualstudio.com/manage`.
2. Copy the publisher ID.
3. Update `package.json`:

```json
"publisher": "your-publisher-id"
```

4. Build the VSIX:

```bash
npm run package:vsix
```

5. Publish the extension:

```bash
npm run publish:marketplace
```

Required credentials:

- Visual Studio Marketplace personal access token

Local installation for testers:

```bash
code --install-extension file-last-updated-0.1.0.vsix
```
