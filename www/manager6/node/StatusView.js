Ext.define('PVE.node.StatusView', {
    extend: 'Proxmox.panel.StatusView',
    alias: 'widget.pveNodeStatus',

    height: 350,
    bodyPadding: '15 5 15 5',

    layout: {
        type: 'table',
        columns: 2,
        tableAttrs: {
            style: {
                width: '100%',
            },
        },
    },

    defaults: {
        xtype: 'pmxInfoWidget',
        padding: '0 10 5 10',
    },

    items: [
        {
            itemId: 'cpu',
            iconCls: 'fa fa-fw pmx-itype-icon-processor pmx-icon',
            title: gettext('CPU usage'),
            valueField: 'cpu',
            maxField: 'cpuinfo',
            renderer: Proxmox.Utils.render_node_cpu_usage,
        },
        {
            itemId: 'wait',
            iconCls: 'fa fa-fw fa-clock-o',
            title: gettext('IO delay'),
            valueField: 'wait',
            rowspan: 2,
        },
        {
            itemId: 'load',
            iconCls: 'fa fa-fw fa-tasks',
            title: gettext('Load average'),
            printBar: false,
            textField: 'loadavg',
        },
        {
            xtype: 'box',
            colspan: 2,
            padding: '0 0 20 0',
        },
        {
            iconCls: 'fa fa-fw pmx-itype-icon-memory pmx-icon',
            itemId: 'memory',
            title: gettext('RAM usage'),
            valueField: 'memory',
            maxField: 'memory',
            warningThreshold: 0.9,
            criticalThreshold: 0.975,
            // TODO: split out ARC usage
            renderer: Proxmox.Utils.render_node_size_usage,
        },
        {
            itemId: 'ksm',
            printBar: false,
            title: gettext('KSM sharing'),
            textField: 'ksm',
            renderer: (record) => Proxmox.Utils.render_size(record.shared),
            padding: '0 10 10 10',
        },
        {
            iconCls: 'fa fa-fw fa-hdd-o',
            itemId: 'rootfs',
            title: '/ ' + gettext('HD space'),
            valueField: 'rootfs',
            maxField: 'rootfs',
            renderer: Proxmox.Utils.render_node_size_usage,
        },
        {
            iconCls: 'fa fa-fw fa-refresh',
            itemId: 'swap',
            printSize: true,
            title: gettext('SWAP usage'),
            valueField: 'swap',
            maxField: 'swap',
            renderer: Proxmox.Utils.render_node_size_usage,
        },
        {
            xtype: 'box',
            colspan: 2,
            padding: '0 0 20 0',
        },
        {
            itemId: 'cpus',
            colspan: 2,
            printBar: false,
            title: gettext('CPU(s)'),
            textField: 'cpuinfo',
            renderer: Proxmox.Utils.render_cpu_model,
            value: '',
        },
        {
            colspan: 2,
            title: gettext('Kernel Version'),
            printBar: false,
            // TODO: remove with next major and only use newish current-kernel textfield
            multiField: true,
            //textField: 'current-kernel',
            renderer: ({ data }) => {
                if (!data['current-kernel']) {
                    return data.kversion;
                }
                let kernel = data['current-kernel'];
                let buildDate = kernel.version.match(/\((.+)\)\s*$/)?.[1] ?? 'unknown';
                return `${kernel.sysname} ${kernel.release} (${buildDate})`;
            },
            value: '',
        },
        {
            colspan: 2,
            title: gettext('Boot Mode'),
            printBar: false,
            textField: 'boot-info',
            renderer: (boot) => {
                if (boot.mode === 'legacy-bios') {
                    return 'Legacy BIOS';
                } else if (boot.mode === 'efi') {
                    return `EFI${boot.secureboot ? ' (Secure Boot)' : ''}`;
                }
                return Proxmox.Utils.unknownText;
            },
            value: '',
        },
        {
            itemId: 'version',
            colspan: 2,
            printBar: false,
            title: gettext('Manager Version'),
            textField: 'pveversion',
            value: '',
        },
    ],

    updateTitle: function () {
        var me = this;
        var uptime = Proxmox.Utils.render_uptime(me.getRecordValue('uptime'));
        me.setTitle(me.pveSelNode.data.node + ' (' + gettext('Uptime') + ': ' + uptime + ')');
    },

    initComponent: function () {
        let me = this;

        let stateProvider = Ext.state.Manager.getProvider();
        let repoLink = stateProvider.encodeHToken({
            view: 'server',
            rid: `node/${me.pveSelNode.data.node}`,
            ltab: 'tasks',
            nodetab: 'aptrepositories',
        });

        me.items.push({
            xtype: 'pmxNodeInfoRepoStatus',
            itemId: 'repositoryStatus',
            product: 'Proxmox VE',
            repoLink: `#${repoLink}`,
        });

        me.callParent();
    },
});
