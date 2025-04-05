include ../defines.mk

all: country.dat

country.dat: country.pl
	./country.pl > country.dat

.PHONY: install
install: country.dat vzdump.conf pve-sources.list pve-initramfs.conf pve-blacklist.conf pve.logrotate
	install -D -m 0644 pve.logrotate $(DESTDIR)/etc/logrotate.d/pve
	install -D -m 0644 pve-sources.list $(DESTDIR)/etc/apt/sources.list.d/pve-enterprise.list
	install -D -m 0644 pve-blacklist.conf $(DESTDIR)/etc/modprobe.d/pve-blacklist.conf
	install -D -m 0644 vzdump.conf $(DESTDIR)/etc/vzdump.conf
	install -D -m 0644 pve-initramfs.conf $(DESTDIR)/etc/initramfs-tools/conf.d/pve-initramfs.conf
	install -D -m 0644 country.dat $(DESTDIR)/usr/share/pve-manager/country.dat
	install -D -m 0644 proxmox-ve-default.link $(DESTDIR)/usr/lib/systemd/network/99-default.link.d/proxmox-mac-address-policy.conf

clean:
	rm -f country.dat
