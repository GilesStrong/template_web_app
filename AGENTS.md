# Style
All functions must have type annotations and docstrings
Docstrings should follow the Google style guide

# Linting
Formatters will be run on all code automatically, so do not waste time on formatting and import ordering. Just write the code and let the linters fix the formatting.

# Testing
Do not use the "generic test runner" for any tests. Use Django's test runner for backend tests and bun for frontend tests. Do not use pytest or any other test runner.

## Backend tests
Tests should have GIVE/WHEN/THEN docstrings

Run using django's test runner, e.g.:
```
cd /workspace/myapp/app && /workspace/myapp/.venv/bin/python manage.py test
```

## Frontend tests
Run tests using bun, e.g.:
```
cd /workspace/myapp/frontend && bun run test --run
```

## Frontend E2E tests
These tests use Playwright. Do not try to run them youself. Ask the user to run them for you.

# Docker
You are running in a devcontainer and do not have docker installed locally. Do not try to run docker commands yourself. Ask the user to run them for you.

# Frontend editing
With the exception of editing test files, after finishing editing frontend code, you must run the build command to ensure type generation and other build steps can run successfully.
```
cd /workspace/myapp/frontend && bunx next build
```

# License headding

All source files must include the following license header at the top of the file:

```
Copyright 2026 Giles Strong

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
