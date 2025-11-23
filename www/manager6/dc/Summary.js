Ext.define('PVE.dc.Summary', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveDcSummary',

    scrollable: true,

    bodyPadding: 5,

    layout: 'column',

    defaults: {
        padding: 5,
        columnWidth: 1,
    },

    items: [
        {
            itemId: 'dcHealth',
            xtype: 'pveDcHealth',
        },
        {
            itemId: 'dcGuests',
            xtype: 'pveDcGuests',
        },
        {
            title: gettext('Resources'),
            xtype: 'panel',
            minHeight: 250,
            bodyPadding: 5,
            layout: 'hbox',
            defaults: {
                xtype: 'proxmoxGauge',
                flex: 1,
            },
            items: [
                {
                    title: gettext('CPU'),
                    itemId: 'cpu',
                },
                {
                    title: gettext('Memory'),
                    itemId: 'memory',
                    warningThreshold: 0.9,
                    criticalThreshold: 0.975,
                },
                {
                    title: gettext('Storage'),
                    itemId: 'storage',
                },
            ],
        },
        {
            itemId: 'nodeview',
            xtype: 'pveDcNodeView',
            height: 250,
        },
        {
            title: gettext('Subscriptions'),
            height: 220,
            items: [
                {
                    xtype: 'pveHealthWidget',
                    itemId: 'subscriptions',
                    userCls: 'pointer',
                    listeners: {
                        element: 'el',
                        click: function () {
                            if (this.component.userCls === 'pointer') {
                                window.open(
                                    'https://www.proxmox.com/en/proxmox-virtual-environment/pricing',
                                    '_blank',
                                );
                            }
                        },
                    },
                },
            ],
        },
    ],

    listeners: {
        resize: function (panel) {
            Proxmox.Utils.updateColumns(panel);
        },
    },

    initComponent: function () {
        var me = this;

        var rstore = Ext.create('Proxmox.data.UpdateStore', {
            interval: 3000,
            storeid: 'pve-cluster-status',
            model: 'pve-dc-nodes',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/status',
            },
        });

        var gridstore = Ext.create('Proxmox.data.DiffStore', {
            rstore: rstore,
            filters: {
                property: 'type',
                value: 'node',
            },
            sorters: {
                property: 'id',
                direction: 'ASC',
            },
        });

        me.callParent();

        me.getComponent('nodeview').setStore(gridstore);

        var gueststatus = me.getComponent('dcGuests');

        var cpustat = me.down('#cpu');
        var memorystat = me.down('#memory');
        var storagestat = me.down('#storage');
        var sp = Ext.state.Manager.getProvider();

        me.mon(PVE.data.ResourceStore, 'load', function (curstore, results) {
            me.suspendLayout = true;

            let cpu = 0,
                maxcpu = 0;
            let memory = 0,
                maxmem = 0;

            let used = 0,
                total = 0;
            let countedStorage = {},
                usableStorages = {};
            let storages = sp.get('dash-storages') || '';
            storages
                .split(',')
                .filter((v) => v !== '')
                .forEach((storage) => {
                    usableStorages[storage] = true;
                });

            let qemu = {
                running: 0,
                paused: 0,
                stopped: 0,
                template: 0,
            };
            let lxc = {
                running: 0,
                paused: 0,
                stopped: 0,
                template: 0,
            };
            let error = 0;

            for (const { data } of results) {
                switch (data.type) {
                    case 'node':
                        cpu += data.cpu * data.maxcpu;
                        maxcpu += data.maxcpu || 0;
                        memory += data.mem || 0;
                        maxmem += data.maxmem || 0;

                        if (gridstore.getById(data.id)) {
                            let griditem = gridstore.getById(data.id);
                            griditem.set('cpuusage', data.cpu);
                            let max = data.maxmem || 1;
                            let val = data.mem || 0;
                            griditem.set('memoryusage', val / max);
                            griditem.set('uptime', data.uptime);
                            griditem.commit(); // else the store marks the field as dirty
                        }
                        break;
                    case 'storage': {
                        let sid = !data.shared || data.storage === 'local' ? data.id : data.storage;
                        if (!Ext.Object.isEmpty(usableStorages)) {
                            if (usableStorages[data.id] !== true) {
                                break;
                            }
                            sid = data.id;
                        } else if (countedStorage[sid]) {
                            break;
                        }

                        if (data.status === 'unknown') {
                            break;
                        }

                        used += data.disk;
                        total += data.maxdisk;
                        countedStorage[sid] = true;
                        break;
                    }
                    case 'qemu':
                        qemu[data.template ? 'template' : data.status]++;
                        if (data.hastate === 'error') {
                            error++;
                        }
                        break;
                    case 'lxc':
                        lxc[data.template ? 'template' : data.status]++;
                        if (data.hastate === 'error') {
                            error++;
                        }
                        break;
                    default:
                        break;
                }
            }

            let text = Ext.String.format(gettext('of {0} CPU(s)'), maxcpu);
            cpustat.updateValue(cpu / maxcpu, text);

            text = Ext.String.format(
                gettext('{0} of {1}'),
                Proxmox.Utils.render_size(memory),
                Proxmox.Utils.render_size(maxmem),
            );
            memorystat.updateValue(memory / maxmem, text);

            text = Ext.String.format(
                gettext('{0} of {1}'),
                Proxmox.Utils.render_size(used),
                Proxmox.Utils.render_size(total),
            );
            storagestat.updateValue(used / total, text);

            gueststatus.updateValues(qemu, lxc, error);

            me.suspendLayout = false;
            me.updateLayout(true);
        });

        let dcHealth = me.getComponent('dcHealth');
        me.mon(rstore, 'load', dcHealth.updateStatus, dcHealth);

        let subs = me.down('#subscriptions');
        me.mon(rstore, 'load', function (store, records, success) {
            var level;
            var mixed = false;
            for (let i = 0; i < records.length; i++) {
                let node = records[i];
                if (node.get('type') !== 'node' || node.get('status') === 'offline') {
                    continue;
                }

                let curlevel = node.get('level');
                if (curlevel === '') {
                    // no subscription beats all, set it and break the loop
                    level = '';
                    break;
                }

                if (level === undefined) {
                    // save level
                    level = curlevel;
                } else if (level !== curlevel) {
                    // detect different levels
                    mixed = true;
                }
            }

            let data = {
                title: Proxmox.Utils.unknownText,
                text: Proxmox.Utils.unknownText,
                iconCls: PVE.Utils.get_health_icon(undefined, true),
            };
            if (level === '') {
                data = {
                    title: gettext('No Subscription'),
                    iconCls: PVE.Utils.get_health_icon('critical', true),
                    text: gettext('You have at least one node without subscription.'),
                };
                subs.setUserCls('pointer');
            } else if (mixed) {
                data = {
                    title: gettext('Mixed Subscriptions'),
                    iconCls: PVE.Utils.get_health_icon('warning', true),
                    text: gettext('Warning: Your subscription levels are not the same.'),
                };
                subs.setUserCls('pointer');
            } else if (level) {
                data = {
                    title: PVE.Utils.render_support_level(level),
                    iconCls: PVE.Utils.get_health_icon('good', true),
                    text: gettext('Your subscription status is valid.'),
                };
                subs.setUserCls('');
            }

            subs.setData(data);
        });

        me.on('destroy', function () {
            rstore.stopUpdate();
        });

        me.mon(sp, 'statechange', function (provider, key, value) {
            if (key !== 'summarycolumns') {
                return;
            }
            Proxmox.Utils.updateColumns(me);
        });

        rstore.startUpdate();
    },
});
