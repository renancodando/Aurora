using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Aurora.Models;
using Microsoft.AspNetCore.Http;

namespace Aurora.Services;

public sealed class ProjetoService
{
    private readonly string _raiz;
    private readonly HttpClient _http = new(new HttpClientHandler
    {
        AllowAutoRedirect = true,
        AutomaticDecompression = DecompressionMethods.All
    });

    public ProjetoService(string raiz)
    {
        _raiz = raiz;
        Directory.CreateDirectory(_raiz);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Aurora/1.0");
    }

    public string Raiz => _raiz;

    public async Task<ManifestoProjeto> ImportarZipAsync(IFormFile arquivo, CancellationToken cancellationToken)
    {
        if (arquivo.Length == 0)
            throw new InvalidDataException("O ZIP está vazio.");
        if (!arquivo.FileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Envie um arquivo .zip.");

        var id = NovoId();
        var pasta = PastaProjeto(id);
        var original = Path.Combine(pasta, "original");
        var trabalho = Path.Combine(pasta, "trabalho");
        Directory.CreateDirectory(original);

        await using var stream = arquivo.OpenReadStream();
        await ZipSeguro.ExtrairAsync(stream, original, cancellationToken);
        CopiarDiretorio(original, trabalho);

        return await CriarManifestoAsync(id, Path.GetFileNameWithoutExtension(arquivo.FileName), "zip", cancellationToken);
    }

    public async Task<ManifestoProjeto> ImportarPastaAsync(IFormFileCollection arquivos, IReadOnlyList<string> caminhos, CancellationToken cancellationToken)
    {
        if (arquivos.Count == 0)
            throw new InvalidDataException("A pasta não possui arquivos.");

        var id = NovoId();
        var pasta = PastaProjeto(id);
        var original = Path.Combine(pasta, "original");
        var trabalho = Path.Combine(pasta, "trabalho");
        Directory.CreateDirectory(original);
        var raizCompleta = Path.GetFullPath(original) + Path.DirectorySeparatorChar;

        for (var i = 0; i < arquivos.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var relativo = i < caminhos.Count && !string.IsNullOrWhiteSpace(caminhos[i]) ? caminhos[i] : arquivos[i].FileName;
            relativo = relativo.Replace('\\', '/');
            if (relativo.Split('/').Any(p => p is ".git" or ".vs" or "bin" or "obj" or "node_modules" or ".vercel"))
                continue;

            var destino = Path.GetFullPath(Path.Combine(original, relativo));
            if (!destino.StartsWith(raizCompleta, StringComparison.OrdinalIgnoreCase))
                continue;

            Directory.CreateDirectory(Path.GetDirectoryName(destino)!);
            await using var saida = File.Create(destino);
            await arquivos[i].CopyToAsync(saida, cancellationToken);
        }

        CopiarDiretorio(original, trabalho);
        var nome = caminhos.FirstOrDefault()?.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "projeto";
        return await CriarManifestoAsync(id, nome, "pasta", cancellationToken);
    }

    public async Task<ManifestoProjeto> ImportarUrlAsync(string url, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new InvalidDataException("URL inválida.");

        var id = NovoId();
        var pasta = PastaProjeto(id);
        var original = Path.Combine(pasta, "original");
        var trabalho = Path.Combine(pasta, "trabalho");
        Directory.CreateDirectory(original);

        var html = await _http.GetStringAsync(uri, cancellationToken);
        html = InjetarBase(html, uri);
        await File.WriteAllTextAsync(Path.Combine(original, "index.html"), html, Encoding.UTF8, cancellationToken);
        CopiarDiretorio(original, trabalho);
        return await CriarManifestoAsync(id, uri.Host, "url", cancellationToken);
    }

    public async Task<ManifestoProjeto> ImportarGitHubAsync(string url, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || !uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Cole a URL pública do repositório no GitHub.");

        var partes = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (partes.Length < 2)
            throw new InvalidDataException("URL do GitHub inválida.");

        var owner = partes[0];
        var repo = partes[1].EndsWith(".git", StringComparison.OrdinalIgnoreCase) ? partes[1][..^4] : partes[1];
        var api = $"https://api.github.com/repos/{Uri.EscapeDataString(owner)}/{Uri.EscapeDataString(repo)}";
        using var infoResponse = await _http.GetAsync(api, cancellationToken);
        infoResponse.EnsureSuccessStatusCode();
        using var infoDoc = JsonDocument.Parse(await infoResponse.Content.ReadAsStreamAsync(cancellationToken));
        var branch = infoDoc.RootElement.GetProperty("default_branch").GetString() ?? "main";

        var zipUrl = $"https://github.com/{owner}/{repo}/archive/refs/heads/{Uri.EscapeDataString(branch)}.zip";
        using var zipResponse = await _http.GetAsync(zipUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        zipResponse.EnsureSuccessStatusCode();

        var id = NovoId();
        var pasta = PastaProjeto(id);
        var original = Path.Combine(pasta, "original");
        var trabalho = Path.Combine(pasta, "trabalho");
        Directory.CreateDirectory(original);
        await using var zipStream = await zipResponse.Content.ReadAsStreamAsync(cancellationToken);
        await ZipSeguro.ExtrairAsync(zipStream, original, cancellationToken);
        NormalizarRaizUnica(original);
        CopiarDiretorio(original, trabalho);

        return await CriarManifestoAsync(id, repo, "github", cancellationToken);
    }

    public async Task<ManifestoProjeto?> ObterManifestoAsync(string id, CancellationToken cancellationToken)
    {
        var caminho = Path.Combine(PastaProjeto(id), "manifesto.json");
        if (!File.Exists(caminho))
            return null;
        await using var stream = File.OpenRead(caminho);
        return await JsonSerializer.DeserializeAsync<ManifestoProjeto>(stream, cancellationToken: cancellationToken);
    }

    public async Task SalvarCorrecoesAsync(string id, string css, object? resumo, CancellationToken cancellationToken)
    {
        var trabalho = Path.Combine(PastaProjeto(id), "trabalho");
        if (!Directory.Exists(trabalho))
            throw new DirectoryNotFoundException("Projeto não encontrado.");

        var cssPath = Path.Combine(trabalho, "aurora-correcoes.css");
        await File.WriteAllTextAsync(cssPath, css, Encoding.UTF8, cancellationToken);

        foreach (var html in Directory.EnumerateFiles(trabalho, "*.html", SearchOption.AllDirectories))
        {
            var conteudo = await File.ReadAllTextAsync(html, cancellationToken);
            if (conteudo.Contains("aurora-correcoes.css", StringComparison.OrdinalIgnoreCase))
                continue;

            var relativo = Path.GetRelativePath(Path.GetDirectoryName(html)!, cssPath).Replace('\\', '/');
            var link = $"<link rel=\"stylesheet\" href=\"{relativo}\" data-aurora=\"responsividade\">";
            conteudo = Regex.IsMatch(conteudo, "</head>", RegexOptions.IgnoreCase)
                ? Regex.Replace(conteudo, "</head>", link + Environment.NewLine + "</head>", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1))
                : link + Environment.NewLine + conteudo;
            await File.WriteAllTextAsync(html, conteudo, Encoding.UTF8, cancellationToken);
        }

        if (resumo is not null)
        {
            var resumoJson = JsonSerializer.Serialize(resumo, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(Path.Combine(PastaProjeto(id), "resumo-correcoes.json"), resumoJson, cancellationToken);
        }
    }

    public async Task SalvarRelatorioAsync(string id, object dados, CancellationToken cancellationToken)
    {
        var pasta = PastaProjeto(id);
        if (!Directory.Exists(pasta))
            throw new DirectoryNotFoundException("Projeto não encontrado.");

        var json = JsonSerializer.Serialize(dados, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(Path.Combine(pasta, "aurora-relatorio.json"), json, cancellationToken);

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("diferencas", out var diferencas))
            return;

        var diffJson = JsonSerializer.Serialize(diferencas, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(Path.Combine(pasta, "aurora-diferencas.json"), diffJson, cancellationToken);

        var markdown = new StringBuilder();
        markdown.AppendLine("# Diferenças geradas pelo AURORA").AppendLine();

        if (diferencas.TryGetProperty("itens", out var itens) && itens.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in itens.EnumerateArray())
            {
                var seletor = item.TryGetProperty("seletor", out var s) ? s.GetString() : null;
                var titulo = item.TryGetProperty("titulo", out var t) ? t.GetString() : "Correção";
                markdown.AppendLine($"## {seletor ?? titulo}").AppendLine();
                markdown.AppendLine($"Problema: {titulo}").AppendLine();

                if (item.TryGetProperty("antes", out var antes) && antes.ValueKind == JsonValueKind.Array)
                {
                    markdown.AppendLine("Antes:");
                    foreach (var linha in antes.EnumerateArray())
                        markdown.AppendLine($"- {linha.GetString()}");
                    markdown.AppendLine();
                }

                if (item.TryGetProperty("depois", out var depois) && depois.ValueKind == JsonValueKind.Array)
                {
                    markdown.AppendLine("Depois:");
                    foreach (var linha in depois.EnumerateArray())
                        markdown.AppendLine($"- {linha.GetString()}");
                    markdown.AppendLine();
                }

                if (item.TryGetProperty("explicacao", out var explicacao))
                    markdown.AppendLine($"Como foi corrigido: {explicacao.GetString()}").AppendLine();
            }
        }

        await File.WriteAllTextAsync(Path.Combine(pasta, "aurora-diferencas.md"), markdown.ToString(), Encoding.UTF8, cancellationToken);
    }

    public async Task RestaurarAsync(string id, CancellationToken cancellationToken)
    {
        var pasta = PastaProjeto(id);
        var original = Path.Combine(pasta, "original");
        var trabalho = Path.Combine(pasta, "trabalho");
        if (!Directory.Exists(original))
            throw new DirectoryNotFoundException("Projeto não encontrado.");

        if (Directory.Exists(trabalho))
            Directory.Delete(trabalho, true);
        await Task.Run(() => CopiarDiretorio(original, trabalho), cancellationToken);
    }

    public async Task<string> ExportarAsync(string id, CancellationToken cancellationToken)
    {
        var pasta = PastaProjeto(id);
        var trabalho = Path.Combine(pasta, "trabalho");
        if (!Directory.Exists(trabalho))
            throw new DirectoryNotFoundException("Projeto não encontrado.");

        var manifesto = await ObterManifestoAsync(id, cancellationToken) ?? throw new InvalidDataException("Manifesto inválido.");
        foreach (var nome in new[] { "aurora-relatorio.json", "aurora-diferencas.json", "aurora-diferencas.md" })
        {
            var origem = Path.Combine(pasta, nome);
            if (File.Exists(origem))
                File.Copy(origem, Path.Combine(trabalho, nome), true);
        }

        var nomeSeguro = Regex.Replace(manifesto.Nome, "[^a-zA-Z0-9._-]+", "-").Trim('-');
        if (string.IsNullOrWhiteSpace(nomeSeguro)) nomeSeguro = "projeto";
        var destino = Path.Combine(pasta, $"{nomeSeguro}-AURORA.zip");
        await Task.Run(() => ZipSeguro.Compactar(trabalho, destino), cancellationToken);
        return destino;
    }

    private async Task<ManifestoProjeto> CriarManifestoAsync(string id, string nome, string entrada, CancellationToken cancellationToken)
    {
        var trabalho = Path.Combine(PastaProjeto(id), "trabalho");
        var inicial = EncontrarInicial(trabalho) ?? throw new InvalidDataException("Não encontrei um arquivo HTML para visualizar.");
        var relativo = Path.GetRelativePath(trabalho, inicial).Replace('\\', '/');
        var quantidade = Directory.EnumerateFiles(trabalho, "*", SearchOption.AllDirectories).Count();
        var manifesto = new ManifestoProjeto(
            id,
            nome,
            entrada,
            $"/workspace/{id}/trabalho/{relativo}",
            relativo,
            DateTimeOffset.UtcNow,
            quantidade);

        var json = JsonSerializer.Serialize(manifesto, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(Path.Combine(PastaProjeto(id), "manifesto.json"), json, cancellationToken);
        return manifesto;
    }

    private string PastaProjeto(string id)
    {
        if (!Regex.IsMatch(id, "^[a-zA-Z0-9_-]+$"))
            throw new InvalidDataException("ID inválido.");
        return Path.Combine(_raiz, id);
    }

    private static string NovoId() => $"p-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}"[..34];

    private static string? EncontrarInicial(string raiz)
    {
        var html = Directory.EnumerateFiles(raiz, "*.html", SearchOption.AllDirectories).ToList();
        return html
            .OrderByDescending(p => Path.GetFileName(p).Equals("index.html", StringComparison.OrdinalIgnoreCase))
            .ThenBy(p => p.Count(c => c is '/' or '\\'))
            .ThenBy(p => p.Length)
            .FirstOrDefault();
    }

    private static void CopiarDiretorio(string origem, string destino)
    {
        Directory.CreateDirectory(destino);
        foreach (var diretorio in Directory.GetDirectories(origem, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(diretorio.Replace(origem, destino, StringComparison.Ordinal));
        foreach (var arquivo in Directory.GetFiles(origem, "*", SearchOption.AllDirectories))
        {
            var novo = arquivo.Replace(origem, destino, StringComparison.Ordinal);
            Directory.CreateDirectory(Path.GetDirectoryName(novo)!);
            File.Copy(arquivo, novo, true);
        }
    }

    private static void NormalizarRaizUnica(string raiz)
    {
        var arquivosRaiz = Directory.GetFiles(raiz);
        var pastas = Directory.GetDirectories(raiz);
        if (arquivosRaiz.Length != 0 || pastas.Length != 1)
            return;

        var unica = pastas[0];
        foreach (var item in Directory.GetFileSystemEntries(unica))
        {
            var destino = Path.Combine(raiz, Path.GetFileName(item));
            if (Directory.Exists(item)) Directory.Move(item, destino);
            else File.Move(item, destino);
        }
        Directory.Delete(unica, true);
    }

    private static string InjetarBase(string html, Uri uri)
    {
        if (Regex.IsMatch(html, "<base\\s", RegexOptions.IgnoreCase))
            return html;
        var baseHref = uri.GetLeftPart(UriPartial.Authority) + uri.AbsolutePath[..Math.Max(1, uri.AbsolutePath.LastIndexOf('/') + 1)];
        var tag = $"<base href=\"{WebUtility.HtmlEncode(baseHref)}\">";
        return Regex.IsMatch(html, "<head[^>]*>", RegexOptions.IgnoreCase)
            ? Regex.Replace(html, "<head([^>]*)>", m => m.Value + Environment.NewLine + tag, RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1))
            : tag + Environment.NewLine + html;
    }
}
