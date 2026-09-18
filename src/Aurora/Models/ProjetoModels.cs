namespace Aurora.Models;

public sealed record ManifestoProjeto(
    string Id,
    string Nome,
    string Entrada,
    string UrlPreview,
    string ArquivoInicial,
    DateTimeOffset CriadoEm,
    int QuantidadeArquivos);

public sealed record ImportarUrlRequest(string Url);
public sealed record ImportarGitHubRequest(string Url);
public sealed record CorrecoesRequest(string Css, object? Resumo);
public sealed record RelatorioRequest(object Dados);
