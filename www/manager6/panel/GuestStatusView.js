Ext.define('PVE.panel.GuestStatusView', {
    extend: 'Proxmox.panel.StatusView',
    alias: 'widget.pveGuestStatusView',
    mixins: ['Proxmox.Mixin.CBind'],

    cbindData: function (initialConfig) {
        var me = this;
        return {
            isQemu: me.pveSelNode.data.type === 'qemu',
            isLxc: me.pveSelNode.data.type === 'lxc',
        };
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        init: function (view) {
            if (view.pveSelNode.data.type !== 'lxc') {
                return;
            }

            const nodename = view.pveSelNode.data.node;
            const vmid = view.pveSelNode.data.vmid;

            Proxmox.Utils.API2Request({
                url: `/api2/extjs/nodes/${nodename}/lxc/${vmid}/config`,
                waitMsgTargetView: view,
                method: 'GET',
                success: ({ result }) => {
                    view.down('#unprivileged').updateValue(
                        Proxmox.Utils.format_boolean(result.data.unprivileged),
                    );
                    view.ostype = Ext.htmlEncode(result.data.ostype);
                },
            });
        },
    },

    layout: {
        type: 'vbox',
        align: 'stretch',
    },

    defaults: {
        xtype: 'pmxInfoWidget',
        padding: '2 25',
    },
    items: [
        {
            xtype: 'box',
            height: 20,
        },
        {
            itemId: 'status',
            title: gettext('Status'),
            iconCls: 'fa fa-info fa-fw',
            printBar: false,
            multiField: true,
            renderer: function (record) {
                var _me = this;
                var text = record.data.status;
                var qmpstatus = record.data.qmpstatus;
                if (qmpstatus && qmpstatus !== record.data.status) {
                    text += ' (' + qmpstatus + ')';
                }
                return text;
            },
        },
        {
            itemId: 'hamanaged',
            iconCls: 'fa fa-heartbeat fa-fw',
            title: gettext('HA State'),
            printBar: false,
            textField: 'ha',
            renderer: PVE.Utils.format_ha,
        },
        {
            itemId: 'node',
            iconCls: 'fa fa-building fa-fw',
            title: gettext('Node'),
            cbind: {
                text: '{pveSelNode.data.node}',
            },
            printBar: false,
        },
        {
            itemId: 'unprivileged',
            iconCls: 'fa fa-lock fa-fw',
            title: gettext('Unprivileged'),
            printBar: false,
            cbind: {
                hidden: '{isQemu}',
            },
        },
        {
            xtype: 'box',
            height: 10,
        },
        {
            itemId: 'cpu',
            iconCls: 'fa fa-fw pmx-itype-icon-processor pmx-icon',
            title: gettext('CPU usage'),
            valueField: 'cpu',
            maxField: 'cpus',
            renderer: Proxmox.Utils.render_cpu_usage,
            // in this specific api call
            // we already have the correct value for the usage
            calculate: Ext.identityFn,
        },
        {
            itemId: 'memory',
            iconCls: 'fa fa-fw pmx-itype-icon-memory pmx-icon',
            title: gettext('Memory usage'),
            valueField: 'mem',
            maxField: 'maxmem',
            warningThreshold: 0.9,
            criticalThreshold: 0.975,
        },
        {
            itemId: 'memory-host',
            iconCls: 'fa fa-fw pmx-itype-icon-memory pmx-icon',
            title: gettext('Host memory usage'),
            valueField: 'memhost',
            printBar: false,
            renderer: function (used, max) {
                return Proxmox.Utils.render_size(used);
            },
            cbind: {
                hidden: '{isLxc}',
                disabled: '{isLxc}',
            },
        },
        {
            itemId: 'swap',
            iconCls: 'fa fa-refresh fa-fw',
            title: gettext('SWAP usage'),
            valueField: 'swap',
            maxField: 'maxswap',
            cbind: {
                hidden: '{isQemu}',
                disabled: '{isQemu}',
            },
        },
        {
            itemId: 'rootfs',
            iconCls: 'fa fa-hdd-o fa-fw',
            title: gettext('Bootdisk size'),
            valueField: 'disk',
            maxField: 'maxdisk',
            printBar: false,
            renderer: function (used, max) {
                var me = this;
                me.setPrintBar(used > 0);
                if (used === 0) {
                    return Proxmox.Utils.render_size(max);
                } else {
                    return Proxmox.Utils.render_size_usage(used, max);
                }
            },
        },
        {
            xtype: 'box',
            height: 10,
        },
        {
            cbind: {
                xtype: (get) => (get('isQemu') ? 'pveIPViewQEMU' : 'pveIPViewLXC'),
                rstore: '{rstore}',
                pveSelNode: '{pveSelNode}',
            },
        },
    ],

    updateTitle: function () {
        var me = this;
        var uptime = me.getRecordValue('uptime');

        var text = '';
        if (Number(uptime) > 0) {
            text =
                ' (' + gettext('Uptime') + ': ' + Proxmox.Utils.format_duration_long(uptime) + ')';
        }

        let title = `<div class="left-aligned">${me.getRecordValue('name') + text}</div>`;

        if (me.pveSelNode.data.type === 'lxc' && me.ostype && me.ostype !== 'unmanaged') {
            // Manual mappings for distros with special casing
            const namemap = {
                archlinux: 'Arch Linux',
                nixos: 'NixOS',
                opensuse: 'openSUSE',
                centos: 'CentOS',
            };

            const distro = namemap[me.ostype] ?? Ext.String.capitalize(me.ostype);
            title += `<div class="right-aligned"><i class="fl-${me.ostype} fl-fw"></i>&nbsp;${distro}</div>`;
        }

        me.setTitle(title);
    },
});
