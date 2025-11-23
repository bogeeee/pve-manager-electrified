
DOCDIR=/usr/share/doc/pve-manager/

TRUSTED_KEYS=				\
	proxmox-release-bookworm.gpg	\
	proxmox-release-trixie.gpg	\
	release@turnkeylinux.com.pubkey

all:

.PHONY: install
install: aplinfo.dat trustedkeys.gpg
	install -D -m 0644 aplinfo.dat $(DESTDIR)$(DOCDIR)/aplinfo.dat
	install -D -m 0644 trustedkeys.gpg $(DESTDIR)$(DOCDIR)/trustedkeys.gpg

.PHONY: update
update:
	rm -f aplinfo.dat
	wget http://download.proxmox.com/images/aplinfo-pve-9.dat -O aplinfo.dat.tmp
	mv aplinfo.dat.tmp aplinfo.dat

trustedkeys.gpg: $(TRUSTED_KEYS)
	sq keyring merge --output $(basename $@).asc.tmp $(TRUSTED_KEYS)
	sq packet dearmor $(basename $@).asc.tmp --output $@.tmp
	rm $(basename $@).asc.tmp
	mv $@.tmp $@

.PHONY: clean
clean:
	rm -rf *~ aplinfo.dat.gz aplinfo.dat.asc trustedkeys.gpg
