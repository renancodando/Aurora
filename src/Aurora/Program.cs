using System.Text.Json;
using System.Threading.RateLimiting;
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
builder.Services.AddHttpClient<InteligenciaLayoutService>();
builder.Services.AddRateLimiter(opcoes =>
{
    opcoes.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    opcoes.AddPolicy("ia", contexto =>
        RateLimitPartition.GetFixedWindowLimiter(
            contexto.Connection.RemoteIpAddress?.ToString() ?? "anonimo",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromHours(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
    opcoes.AddPolicy("importacao", contexto =>
        RateLimitPartition.GetFixedWindowLimiter(
            contexto.Connection.RemoteIpAddress?.ToString() ?? "anonimo",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(10),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});

var app = builder.Build();

app.Use(async (contexto, proximo) =>
{
    contexto.Response.Headers["X-Content-Type-Options"] = "nosniff";
    contexto.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    contexto.Response.Headers["X-Frame-Options"] = "DENY";
    await proximo();
});

app.UseRateLimiter();

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
}).DisableAntiforgery().RequireRateLimiting("importacao");

app.MapPost("/api/projetos/pasta", async (HttpRequest request, ProjetoService projetos, CancellationToken ct) =>
{
    try
    {
        var form = await request.ReadFormAsync(ct);
        var caminhos = form["caminhos"].ToArray();
        return Results.Ok(await projetos.ImportarPastaAsync(form.Files, caminhos, ct));
    }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
}).DisableAntiforgery().RequireRateLimiting("importacao");

app.MapPost("/api/projetos/url", async (ImportarUrlRequest pedido, ProjetoService projetos, CancellationToken ct) =>
{
    try { return Results.Ok(await projetos.ImportarUrlAsync(pedido.Url, ct)); }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
}).RequireRateLimiting("importacao");

app.MapPost("/api/projetos/github", async (ImportarGitHubRequest pedido, ProjetoService projetos, CancellationToken ct) =>
{
    try { return Results.Ok(await projetos.ImportarGitHubAsync(pedido.Url, ct)); }
    catch (Exception ex) { return Results.BadRequest(new { erro = ex.Message }); }
}).RequireRateLimiting("importacao");

app.MapPost("/api/inteligencia-layout", async (JsonElement pedido, InteligenciaLayoutService inteligencia, CancellationToken ct) =>
{
    try { return Results.Ok(await inteligencia.AvaliarAsync(pedido, ct)); }
    catch (InvalidDataException ex) { return Results.BadRequest(new { erro = ex.Message }); }
    catch (Exception ex) { return Results.Json(new { erro = ex.Message }, statusCode: 503); }
}).RequireRateLimiting("ia");

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
