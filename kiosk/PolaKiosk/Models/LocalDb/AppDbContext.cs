using Microsoft.EntityFrameworkCore;

namespace PolaKiosk.Models.LocalDb;

public class AppDbContext : DbContext
{
    public DbSet<EventEntity> Events { get; set; } = null!;
    public DbSet<TemplateEntity> Templates { get; set; } = null!;
    public DbSet<SessionEntity> Sessions { get; set; } = null!;
    public DbSet<PrintCountEntity> PrintCounts { get; set; } = null!;
    public DbSet<PrintLogEntity> PrintLogs { get; set; } = null!;
    public DbSet<KioskLogEntity> KioskLogs { get; set; } = null!;
    public DbSet<GuestResponseEntity> GuestResponses { get; set; } = null!;
    public DbSet<PhotoConsentEntity> PhotoConsents { get; set; } = null!;

    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PrintCountEntity>()
            .HasKey(p => p.SessionId);
    }
}
