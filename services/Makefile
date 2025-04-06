include ../defines.mk

all:

SERVICES=			\
	pvebanner.service 	\
	pvenetcommit.service 	\
	pvestatd.service 	\
	pve-guests.service 	\
	pvedaemon.service  	\
	pveproxy.service 	\
	pvenodejsserver.service \
	spiceproxy.service	\
	pve-storage.target	\
	pve-daily-update.service\
	pve-daily-update.timer	\
	pvescheduler.service

.PHONY: install
install: $(SERVICES)
	install -d $(SERVICEDIR)
	install -m 0644 $(SERVICES) $(SERVICEDIR)
	install -d $(SERVICEDIR)/ceph-mon@.service.d
	install -m 0644 ceph-after-pve-cluster.conf $(SERVICEDIR)/ceph-mon@.service.d
	install -d $(SERVICEDIR)/ceph-mgr@.service.d
	install -m 0644 ceph-after-pve-cluster.conf $(SERVICEDIR)/ceph-mgr@.service.d
	install -d $(SERVICEDIR)/ceph-osd@.service.d
	install -m 0644 ceph-after-pve-cluster.conf $(SERVICEDIR)/ceph-osd@.service.d
	install -d $(SERVICEDIR)/ceph-volume@.service.d
	install -m 0644 ceph-after-pve-cluster.conf $(SERVICEDIR)/ceph-volume@.service.d
	install -d $(SERVICEDIR)/ceph-mds@.service.d
	install -m 0644 ceph-after-pve-cluster.conf $(SERVICEDIR)/ceph-mds@.service.d
	install -d $(DESTDIR)/usr/share/doc/pve-manager/examples/

.PHONY: clean
clean:
	rm -rf *~
