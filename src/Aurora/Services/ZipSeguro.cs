using System.IO.Compression;

namespace Aurora.Services;

public static class ZipSeguro
{
    private static readonly string[] PastasIgnoradas = [".git", ".vs", "bin", "obj", "node_modules", ".vercel"];
    private const long LimiteTotal = 512L * 1024 * 1024;
    private const long LimiteArquivo = 128L * 1024 * 1024;
    private const int LimiteEntradas = 25_000;

    public static async Task ExtrairAsync(Stream origem, string destino, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(destino);
        var destinoCompleto = Path.GetFullPath(destino) + Path.DirectorySeparatorChar;

        using var zip = new ZipArchive(origem, ZipArchiveMode.Read, leaveOpen: true);
        if (zip.Entries.Count > LimiteEntradas)
            throw new InvalidDataException("O ZIP possui arquivos demais.");

        long totalDeclarado = 0;
        foreach (var entrada in zip.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(entrada.FullName))
                continue;

            var partes = entrada.FullName.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (partes.Any(p => PastasIgnoradas.Contains(p, StringComparer.OrdinalIgnoreCase)))
                continue;

            if (entrada.Length > LimiteArquivo)
                throw new InvalidDataException($"O arquivo {entrada.Name} ultrapassa o limite seguro.");

            totalDeclarado += entrada.Length;
            if (totalDeclarado > LimiteTotal)
                throw new InvalidDataException("O conteúdo extraído do ZIP ultrapassa 512 MB.");

            var caminho = Path.GetFullPath(Path.Combine(destino, entrada.FullName));
            if (!caminho.StartsWith(destinoCompleto, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("O ZIP possui um caminho inválido.");

            if (entrada.FullName.EndsWith('/'))
            {
                Directory.CreateDirectory(caminho);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(caminho)!);
            await using var entradaStream = entrada.Open();
            await using var arquivo = File.Create(caminho);
            await CopiarLimitadoAsync(entradaStream, arquivo, LimiteArquivo, cancellationToken);
        }
    }

    private static async Task CopiarLimitadoAsync(Stream origem, Stream destino, long limite, CancellationToken cancellationToken)
    {
        var buffer = new byte[81920];
        long total = 0;

        while (true)
        {
            var lidos = await origem.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
            if (lidos == 0) break;

            total += lidos;
            if (total > limite)
                throw new InvalidDataException("Um arquivo do ZIP ultrapassou o limite seguro durante a extração.");

            await destino.WriteAsync(buffer.AsMemory(0, lidos), cancellationToken);
        }
    }

    public static void Compactar(string origem, string destinoZip)
    {
        if (File.Exists(destinoZip))
            File.Delete(destinoZip);

        ZipFile.CreateFromDirectory(origem, destinoZip, CompressionLevel.Optimal, includeBaseDirectory: false);
    }
}
