using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Aurora.Services;

public sealed class InteligenciaLayoutService
{
    private const string ModeloCloudflare = "@cf/google/gemma-4-26b-a4b-it";
    private const string ModeloGroq = "openai/gpt-oss-120b";
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly JsonSerializerOptions _opcoes = new() { PropertyNameCaseInsensitive = true };

    public InteligenciaLayoutService(HttpClient http, IConfiguration config)
    {
        _http = http;
        _config = config;
    }

    public async Task<object> AvaliarAsync(JsonElement pedido, CancellationToken cancellationToken)
    {
        if (pedido.GetRawText().Length > 70_000)
            throw new InvalidDataException("Pedido de análise grande demais.");

        if (!pedido.TryGetProperty("casos", out var lista) || lista.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("Nenhum caso enviado.");

        var casos = lista.EnumerateArray().Take(10).Select(x => x.Clone()).ToList();
        if (casos.Count == 0)
            throw new InvalidDataException("Nenhum caso enviado.");

        Envelope? principal = null;
        try { principal = await CloudflareAsync(casos, cancellationToken); } catch { }

        if (principal is null)
        {
            var unica = await GroqAsync(casos, cancellationToken)
                ?? throw new InvalidOperationException("Configure CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN ou GROQ_API_KEY.");
            return new { provedor = "groq", resultados = Combinar(casos, unica, null) };
        }

        var mapa = principal.Resultados.ToDictionary(x => x.Id, StringComparer.Ordinal);
        var duvidosos = casos.Where(c =>
        {
            var id = Id(c);
            return !mapa.TryGetValue(id, out var r) || r.Classificacao == "ambiguo" || r.Confianca < .88;
        }).ToList();

        Envelope? segunda = null;
        if (duvidosos.Count > 0)
        {
            try { segunda = await GroqAsync(duvidosos, cancellationToken); } catch { }
        }

        return new
        {
            provedor = segunda is null ? "cloudflare" : "cloudflare+groq",
            modeloPrincipal = ModeloCloudflare,
            modeloFallback = segunda is null ? null : ModeloGroq,
            resultados = Combinar(casos, principal, segunda)
        };
    }

    private async Task<Envelope?> CloudflareAsync(IReadOnlyList<JsonElement> casos, CancellationToken ct)
    {
        var account = _config["CLOUDFLARE_ACCOUNT_ID"];
        var token = _config["CLOUDFLARE_API_TOKEN"];
        if (string.IsNullOrWhiteSpace(account) || string.IsNullOrWhiteSpace(token)) return null;

        var payload = new
        {
            messages = Mensagens(casos, "Você é o juiz de intenção de layout do AURORA. Seja conservador e nunca autorize correção quando um comportamento visual puder ser intencional."),
            response_format = new { type = "json_schema", json_schema = Schema() },
            temperature = .05,
            max_tokens = 1400,
            options = new { rejectIfBusy = true }
        };

        using var req = new HttpRequestMessage(HttpMethod.Post,
            "https://api.cloudflare.com/client/v4/accounts/" + Uri.EscapeDataString(account) + "/ai/run/" + ModeloCloudflare);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Content = Conteudo(payload);

        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException("Cloudflare " + (int)res.StatusCode);

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        var resposta = doc.RootElement.GetProperty("result").GetProperty("response");
        if (resposta.ValueKind == JsonValueKind.Object)
            return JsonSerializer.Deserialize<Envelope>(resposta.GetRawText(), _opcoes);

        var texto = resposta.GetString();
        return string.IsNullOrWhiteSpace(texto) ? null : JsonSerializer.Deserialize<Envelope>(texto, _opcoes);
    }

    private async Task<Envelope?> GroqAsync(IReadOnlyList<JsonElement> casos, CancellationToken ct)
    {
        var token = _config["GROQ_API_KEY"];
        if (string.IsNullOrWhiteSpace(token)) return null;

        var payload = new
        {
            model = ModeloGroq,
            messages = Mensagens(casos, "Você é a segunda opinião do AURORA para casos ambíguos de CSS e layout. Classifique intenção, não escreva correções. Na dúvida, não autorize alteração automática."),
            response_format = new
            {
                type = "json_schema",
                json_schema = new { name = "aurora_layout", strict = true, schema = Schema() }
            },
            reasoning_effort = "medium",
            max_completion_tokens = 1400
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.groq.com/openai/v1/chat/completions");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Content = Conteudo(payload);

        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException("Groq " + (int)res.StatusCode);

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        var texto = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
        return string.IsNullOrWhiteSpace(texto) ? null : JsonSerializer.Deserialize<Envelope>(texto, _opcoes);
    }

    private static object[] Mensagens(IReadOnlyList<JsonElement> casos, string sistema)
    {
        var entrada = JsonSerializer.Serialize(new
        {
            tarefa = "Classifique problemas ambíguos de layout responsivo. Não gere CSS.",
            regras = new[]
            {
                "erro_real: o layout realmente quebra e deve ser corrigido",
                "comportamento_intencional: overflow ou posição fora da viewport faz parte do componente e deve ser preservado",
                "ambiguo: evidência insuficiente ou conflitante; corrigir deve ser false",
                "Ticker, marquee, carrossel, slider, track animado e transform podem ultrapassar a viewport de propósito",
                "Elemento pequeno fora da viewport pode estar apenas deslocado por animação"
            },
            casos
        });

        return new object[]
        {
            new { role = "system", content = sistema },
            new { role = "user", content = entrada }
        };
    }

    private static object Schema() => new
    {
        type = "object",
        additionalProperties = false,
        properties = new
        {
            resultados = new
            {
                type = "array",
                maxItems = 10,
                items = new
                {
                    type = "object",
                    additionalProperties = false,
                    properties = new
                    {
                        id = new { type = "string" },
                        classificacao = new { type = "string", @enum = new[] { "erro_real", "comportamento_intencional", "ambiguo" } },
                        confianca = new { type = "number", minimum = 0, maximum = 1 },
                        corrigir = new { type = "boolean" },
                        motivo = new { type = "string" },
                        evidencias = new { type = "array", items = new { type = "string" }, maxItems = 8 }
                    },
                    required = new[] { "id", "classificacao", "confianca", "corrigir", "motivo", "evidencias" }
                }
            }
        },
        required = new[] { "resultados" }
    };

    private static IReadOnlyList<object> Combinar(IReadOnlyList<JsonElement> casos, Envelope principal, Envelope? segunda)
    {
        var a = principal.Resultados.ToDictionary(x => x.Id, StringComparer.Ordinal);
        var b = segunda?.Resultados.ToDictionary(x => x.Id, StringComparer.Ordinal) ?? new Dictionary<string, Resultado>(StringComparer.Ordinal);
        var saida = new List<object>();

        foreach (var caso in casos)
        {
            var id = Id(caso);
            a.TryGetValue(id, out var p);
            b.TryGetValue(id, out var s);

            if (p is null && s is not null) { saida.Add(Resposta(s, ModeloGroq, false)); continue; }
            if (p is null)
            {
                saida.Add(new { id, classificacao = "ambiguo", confianca = 0d, corrigir = false, motivo = "IA indisponível para este caso.", evidencias = Array.Empty<string>(), modelo = (string?)null, segundaOpiniao = false });
                continue;
            }
            if (s is null) { saida.Add(Resposta(p, ModeloCloudflare, false)); continue; }

            if (p.Classificacao != s.Classificacao || p.Corrigir != s.Corrigir)
            {
                saida.Add(new
                {
                    id,
                    classificacao = "ambiguo",
                    confianca = Math.Max(.5, Math.Min(p.Confianca, s.Confianca)),
                    corrigir = false,
                    motivo = "Os modelos discordaram. " + ModeloCloudflare + ": " + p.Motivo + " | " + ModeloGroq + ": " + s.Motivo,
                    evidencias = p.Evidencias.Concat(s.Evidencias).Distinct().Take(8).ToArray(),
                    modelo = ModeloCloudflare + " + " + ModeloGroq,
                    segundaOpiniao = true
                });
                continue;
            }

            var escolhido = s.Confianca >= p.Confianca ? s : p;
            saida.Add(new
            {
                id,
                classificacao = escolhido.Classificacao,
                confianca = Math.Max(p.Confianca, s.Confianca),
                corrigir = escolhido.Corrigir,
                motivo = escolhido.Motivo,
                evidencias = p.Evidencias.Concat(s.Evidencias).Distinct().Take(8).ToArray(),
                modelo = ModeloCloudflare + " + " + ModeloGroq,
                segundaOpiniao = true
            });
        }

        return saida;
    }

    private static object Resposta(Resultado r, string modelo, bool segundaOpiniao) => new
    {
        id = r.Id,
        classificacao = r.Classificacao,
        confianca = r.Confianca,
        corrigir = r.Corrigir,
        motivo = r.Motivo,
        evidencias = r.Evidencias,
        modelo,
        segundaOpiniao
    };

    private static string Id(JsonElement caso) => caso.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "";

    private static StringContent Conteudo(object valor) =>
        new(JsonSerializer.Serialize(valor), Encoding.UTF8, "application/json");

    private sealed record Envelope(IReadOnlyList<Resultado> Resultados);
    private sealed record Resultado(string Id, string Classificacao, double Confianca, bool Corrigir, string Motivo, IReadOnlyList<string> Evidencias);
}
