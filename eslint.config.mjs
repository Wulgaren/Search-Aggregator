import eslint from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "node_modules/**",
            "public/**",
            "script.js",
            "early-fetch-entry.js",
            "eslint.config.mjs",
            "vite.config.ts",
            "**/*.mjs",
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked.map((config) => ({
        ...config,
        files: ["**/*.ts"],
    })),
    {
        files: ["**/*.ts"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.es2022,
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/consistent-type-imports": [
                "error",
                { prefer: "type-imports", fixStyle: "separate-type-imports" },
            ],
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "@typescript-eslint/no-non-null-assertion": "warn",
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
            "@typescript-eslint/ban-ts-comment": [
                "error",
                {
                    "ts-expect-error": "allow-with-description",
                    "ts-ignore": true,
                    "ts-nocheck": true,
                    minimumDescriptionLength: 10,
                },
            ],
            "@typescript-eslint/switch-exhaustiveness-check": "error",
            eqeqeq: ["error", "always", { null: "ignore" }],
            "no-throw-literal": "error",
            "prefer-const": "error",
            "no-console": "warn",
        },
    },
    {
        files: ["**/*.test.ts", "vitest.setup.ts"],
        plugins: { vitest },
        rules: {
            ...vitest.configs.recommended.rules,
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/consistent-type-assertions": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/require-await": "off",
            "@typescript-eslint/no-unnecessary-type-assertion": "off",
            "@typescript-eslint/consistent-type-imports": "off",
            "no-console": "off",
        },
    },
    {
        files: ["scripts/**/*.ts", "api/**/*.ts", "lib/**/*.ts"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "no-console": "off",
        },
    },
    {
        files: ["src/**/*.ts"],
        ignores: ["src/**/*.test.ts"],
        rules: {
            // Client diagnostics — allow warn/error, ban console.log noise
            "no-console": ["error", { allow: ["warn", "error"] }],
        },
    }
);
