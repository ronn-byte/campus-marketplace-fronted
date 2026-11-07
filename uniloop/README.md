# UniLoop frontend

This is an independent static React/Vite frontend. It does not share the MUT
Market application routes or call its backend.

From the repository root, build this app with the existing Vite installation:

```powershell
.\node_modules\.bin\vite.cmd build .\uniloop
```

The generated `uniloop/dist/` directory can be deployed separately from the
MUT Market build. No production deployment or domain configuration is included
in this checkpoint.
