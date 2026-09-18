using Aurora.Models;
using Aurora.Services;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<FormOptions>(opcoes =>
{
    opcoes.MultipartBodyLengthLimit = 512L * 1024 * 1024;
    opcoes.ValueLengthLimit = int.MaxValue;
});

var raizWorkspace = Path.Combine(builder.Environment.ContentRootPath, ".aurora-workspace");
Directory.CreateDirectory(raizWorkspace);
builder.Services.AddSingleton(new ProjetoService(raizWorkspace));

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(raizWorkspace),
    RequestPath = "/workspace",
    ServeUnknownFileTypes = true
});

app.MapPost("/api/projetos/zip", async (IFormFile arquivo, ProjetoService projetos, CancellationToken ct) =>
{
    try { return Results.Ok(await projetos.ImportarZipAsync(arquivo, ct)); }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
}).DisableAntiforgery();

app.MapPost("/api/projetos/pasta", async (HttpRequest request, ProjetoService projetos, CancellationToken ct) =>
{
    try
    {
        var form = await request.ReadFormAsync(ct);
        var caminhos = form["caminhos"].ToArray();
        return Results.Ok(await projetos.ImportarPastaAsync(form.Files, caminhos, ct));
    }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
}).DisableAntiforgery();

app.MapPost("/api/projetos/url", async (ImportarUrlRequest pedido, ProjetoService projetos, CancellationToken ct) =>
{
    try { return Results.Ok(await projetos.ImportarUrlAsync(pedido.Url, ct)); }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
});

app.MapPost("/api/projetos/github", async (ImportarGitHubRequest pedido, ProjetoService projetos, CancellationToken ct) =>
{
    try { return Results.Ok(await projetos.ImportarGitHubAsync(pedido.Url, ct)); }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
});

app.MapGet("/api/projetos/{id}", async (string id, ProjetoService projetos, CancellationToken ct) =>
{
    var manifesto = await projetos.ObterManifestoAsync(id, ct);
    return manifesto is null ? Results.NotFound() : Results.Ok(manifesto);
});

app.MapPost("/api/projetos/{id}/correcoes", async (string id, CorrecoesRequest pedido, ProjetoService projetos, CancellationToken ct) =>
{
    try
    {
        await projetos.SalvarCorrecoesAsync(id, pedido.Css, pedido.Resumo, ct);
        return Results.Ok(new { ok = true });
    }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
});

app.MapPost("/api/projetos/{id}/relatorio", async (string id, RelatorioRequest pedido, ProjetoService projetos, CancellationToken ct) =>
{
    try
    {
        await projetos.SalvarRelatorioAsync(id, pedido.Dados, ct);
        return Results.Ok(new { ok = true });
    }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
});

app.MapPost("/api/projetos/{id}/restaurar", async (string id, ProjetoService projetos, CancellationToken ct) =>
{
    try
    {
        await projetos.RestaurarAsync(id, ct);
        return Results.Ok(new { ok = true });
    }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
});

app.MapGet("/api/projetos/{id}/exportar", async (string id, ProjetoService projetos, CancellationToken ct) =>
{
    try
    {
        var caminho = await projetos.ExportarAsync(id, ct);
        return Results.File(caminho, "application/zip", Path.GetFileName(caminho), enableRangeProcessing: true);
    }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
});

app.MapFallbackToFile("index.html");
app.Run();
