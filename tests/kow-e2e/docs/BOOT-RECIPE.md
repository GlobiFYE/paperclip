# Proven boot recipe (substrate validated 2026-10-08)

Root-free qemu guest as `claude` WORKS end to end. Verified: SSH up ~10s,
systemd-detect-virt=kvm, cloud-init runcmd ran, passwordless sudo, guest egress
HTTP 200 (installs possible).

Gotchas learned:
- `-serial file:PATH` (colon), NOT `-serial file=PATH` (invalid char driver).
- The task harness KILLS a plain backgrounded qemu (exit 144). Launch detached:
  a `boot.sh` that does `setsid qemu ... </dev/null >/dev/null 2>&1 &` and
  records `$!`; run it via nohup. qemu is then orphaned and survives.
- ALL ssh calls need `-F /dev/null`: the host /etc/ssh/ssh_config.d has a
  bad-perms file that aborts the ssh client otherwise.
- cloud-localds seed.iso + overlay (`qemu-img create -f qcow2 -F qcow2 -b base`).
- Working qemu line: -accel kvm -machine q35 -cpu host -m 2048 -smp 2
  -display none -serial file:CONSOLE -monitor none
  -drive file=OVERLAY,if=virtio -drive file=SEED,if=virtio,format=raw
  -netdev user,id=n0,hostfwd=tcp:127.0.0.1:PORT-:22 -device virtio-net-pci,netdev=n0
- Boot budget: SSH ~10-30s; poll with ConnectTimeout=5 up to ~150s.
- Teardown: kill by recorded PID (never fuser -k a port).
