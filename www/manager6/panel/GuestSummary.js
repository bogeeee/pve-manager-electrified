Ext.define('PVE.guest.Summary', {
    extend: 'Ext.panel.Panel',
    xtype: 'pveGuestSummary',

    scrollable: true,
    bodyPadding: 5,

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        var vmid = me.pveSelNode.data.vmid;
        if (!vmid) {
            throw 'no VM ID specified';
        }

        if (!me.workspace) {
            throw 'no workspace specified';
        }

        if (!me.statusStore) {
            throw 'no status storage specified';
        }

        var type = me.pveSelNode.data.type;
        var template = !!me.pveSelNode.data.template;
        var rstore = me.statusStore;

        let hideMemhostStateKey = 'pve-vm-hide-memhost';
        let sp = Ext.state.Manager.getProvider();

        let memoryStats = {
            fields: ['maxmem', 'mem'],
            fieldTitles: [gettext('Total'), gettext('Used')],
        };
        if (type === 'qemu') {
            memoryStats.fields.push({
                type: 'line',
                fill: false,
                yField: 'memhost',
                title: gettext('Host Memory Usage'),
                hidden: sp.get(hideMemhostStateKey, true),
                style: {
                    lineWidth: 2.5,
                    opacity: 1,
                },
            });
        }

        var items = [
            {
                xtype: template ? 'pveTemplateStatusView' : 'pveGuestStatusView',
                flex: 1,
                padding: template ? '5' : '0 5 0 0',
                itemId: 'gueststatus',
                pveSelNode: me.pveSelNode,
                rstore: rstore,
            },
            {
                xtype: 'pmxNotesView',
                flex: 1,
                padding: template ? '5' : '0 0 0 5',
                itemId: 'notesview',
                pveSelNode: me.pveSelNode,
            },
        ];

        var rrdstore;
        if (!template) {
            // in non-template mode put the two panels always together
            items = [
                {
                    xtype: 'container',
                    height: 300,
                    layout: {
                        type: 'hbox',
                        align: 'stretch',
                    },
                    items: items,
                },
            ];

            rrdstore = Ext.create('Proxmox.data.RRDStore', {
                rrdurl: `/api2/json/nodes/${nodename}/${type}/${vmid}/rrddata`,
                model: 'pve-rrd-guest',
            });

            items.push(
                {
                    xtype: 'proxmoxRRDChart',
                    title: gettext('CPU Usage'),
                    pveSelNode: me.pveSelNode,
                    fields: ['cpu'],
                    fieldTitles: [gettext('CPU usage')],
                    unit: 'percent',
                    store: rrdstore,
                },
                {
                    xtype: 'proxmoxRRDChart',
                    title: gettext('Memory Usage'),
                    pveSelNode: me.pveSelNode,
                    fields: memoryStats.fields,
                    fieldTitles: memoryStats.fieldTitles,
                    colors: ['#94ae0a', '#115fa6', '#c4c0c0'],
                    unit: 'bytes',
                    powerOfTwo: true,
                    store: rrdstore,
                    onLegendChange: function (_legend, record, _, seriesIndex) {
                        if (seriesIndex === 2) {
                            // third data series is clicked -> hostmem
                            sp.set(hideMemhostStateKey, record.data.disabled);
                        }
                    },
                },
                {
                    xtype: 'proxmoxRRDChart',
                    title: gettext('Network Traffic'),
                    pveSelNode: me.pveSelNode,
                    fields: ['netin', 'netout'],
                    fieldTitles: [gettext('Incoming'), gettext('Outgoing')],
                    store: rrdstore,
                },
                {
                    xtype: 'proxmoxRRDChart',
                    title: gettext('Disk IO'),
                    pveSelNode: me.pveSelNode,
                    fields: ['diskread', 'diskwrite'],
                    fieldTitles: [gettext('Reads'), gettext('Writes')],
                    store: rrdstore,
                },
                {
                    xtype: 'proxmoxRRDChart',
                    title: gettext('CPU Pressure Stall'),
                    pveSelNode: me.pveSelNode,
                    fieldTitles: ['Some', 'Full'],
                    fields: ['pressurecpusome', 'pressurecpufull'],
                    colors: ['#FFD13E', '#A61120'],
                    store: rrdstore,
                    unit: 'percent',
                },
                {
                    xtype: 'proxmoxRRDChart',
                    title: gettext('IO Pressure Stall'),
                    pveSelNode: me.pveSelNode,
                    fieldTitles: ['Some', 'Full'],
                    fields: ['pressureiosome', 'pressureiofull'],
                    colors: ['#FFD13E', '#A61120'],
                    store: rrdstore,
                    unit: 'percent',
                },
                {
                    xtype: 'proxmoxRRDChart',
                    title: gettext('Memory Pressure Stall'),
                    pveSelNode: me.pveSelNode,
                    fieldTitles: ['Some', 'Full'],
                    fields: ['pressurememorysome', 'pressurememoryfull'],
                    colors: ['#FFD13E', '#A61120'],
                    store: rrdstore,
                    unit: 'percent',
                },
            );
        }

        Ext.apply(me, {
            tbar: ['->', { xtype: 'proxmoxRRDTypeSelector' }],
            items: [
                {
                    xtype: 'container',
                    itemId: 'itemcontainer',
                    layout: {
                        type: 'column',
                    },
                    minWidth: 700,
                    defaults: {
                        minHeight: 360,
                        padding: 5,
                    },
                    items: items,
                    listeners: {
                        resize: function (container) {
                            Proxmox.Utils.updateColumns(container);
                        },
                    },
                },
            ],
        });

        me.callParent();
        if (!template) {
            rrdstore.startUpdate();
            me.on('destroy', rrdstore.stopUpdate);
        }
        me.mon(sp, 'statechange', function (provider, key, value) {
            if (key !== 'summarycolumns') {
                return;
            }
            Proxmox.Utils.updateColumns(me.getComponent('itemcontainer'));
        });
    },
});
