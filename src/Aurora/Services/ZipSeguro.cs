using System.IO.Compression;

namespace Aurora.Services;

public static class ZipSeguro
{
    private static readonly string[] PastasIgnoradas = [".git", ".vs", "bin", "obj", "node_modules", ".vercel"];

    public static async Task ExtrairAsync(Stream origem, string destino, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(destino);
        var destinoCompleto = Path.GetFullPath(destino) + Path.DirectorySeparatorChar;

        using var zip = new ZipArchive(origem, ZipArchiveMode.Read, leaveOpen: true);
        foreach (var entrada in zip.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(entrada.FullName))
                continue;

            var partes = entrada.FullName.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (partes.Any(p => PastasIgnoradas.Contains(p, StringComparer.OrdinalIgnoreCase)))
                continue;

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
            await entradaStream.CopyToAsync(arquivo, cancellationToken);
        }
    }

    public static void Compactar(string origem, string destinoZip)
    {
        if (File.Exists(destinoZip))
            File.Delete(destinoZip);

        ZipFile.CreateFromDirectory(origem, destinoZip, CompressionLevel.Optimal, includeBaseDirectory: false);
    }
}
