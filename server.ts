import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isTest = process.env.NODE_ENV === "test" || !!process.env.VITE_TEST_BUILD;

export async function createServer(
    root = process.cwd(),
    isProd = process.env.NODE_ENV === "production",
    hmrPort?: number
) {
    const resolve = (p: string) => path.resolve(__dirname, p);

    const indexProd = isProd
        ? fs.readFileSync(resolve("dist/client/index.html"), "utf-8")
        : "";

    const app = express();

    /**
     * @type {import('vite').ViteDevServer}
     */
    let vite: any;
    if (!isProd) {
        vite = await (
            await import("vite")
        ).createServer({
            root,
            logLevel: isTest ? "error" : "info",
            server: {
                middlewareMode: true,
                watch: {
                    usePolling: true,
                    interval: 100,
                },
                hmr: {
                    port: hmrPort,
                },
            },
            appType: "custom",
        });
        app.use(vite.middlewares);
    } else {
        app.use((await import("compression")).default());
        app.use(
            (await import("serve-static")).default(resolve("dist/client"), {
                index: false,
            })
        );
    }

    app.use("*", async (req, res) => {
        try {
            const url = req.originalUrl;

            let template, render;
            if (!isProd) {
                // always read fresh template in dev
                template = fs.readFileSync(resolve("index.html"), "utf-8");
                template = await vite.transformIndexHtml(url, template);
                render = (await vite.ssrLoadModule("/src/entry-server.tsx"))
                    .default;
            } else {
                template = indexProd;
                // @ts-ignore
                render = (await import("./dist/server/entry-server.js"))
                    .default;
            }

            const context: Record<string, any> = {};
            const appHtml = render(url);

            if (context.url) {
                // Somewhere a `<Redirect>` was rendered
                return res.redirect(301, context.url);
            }

            const html = template.replace(`<!--ssr-outlet-->`, appHtml);
            res.status(200).set({ "Content-Type": "text/html" }).end(html);
        } catch (e) {
            !isProd && vite.ssrFixStacktrace(e);
            console.log((e as Error).stack);
            res.status(500).end((e as Error).stack);
        }
    });

    return { app, vite };
}

if (!isTest) {
    createServer().then(({ app }) =>
        app.listen(5173, () => {
            console.log("http://localhost:5173");
        })
    );
}
