interface Bindings {
  API: Fetcher
}

export const onRequest: PagesFunction<Bindings> = ({ request, env }) => env.API.fetch(request)
